import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "@hono/hono/cors";
import type { AppConfig } from "./config.ts";
import type { AppDatabase } from "./db/client.ts";
import type { Logger } from "./shared/logger/index.ts";
import { AppError } from "./http/errors.ts";
import { toErrorResponse } from "./http/error-handler.ts";
import type { AppEnv } from "./http/types.ts";
import { healthRoute, readyRoute, registerOpenApiDocument } from "./http/openapi.ts";
import { requestId } from "./http/middleware/request-id.ts";
import { requestLogger } from "./http/middleware/request-logger.ts";
import { bodyLimit } from "./http/middleware/body-limit.ts";
import { securityHeaders } from "./http/middleware/security-headers.ts";
import { csrfProtection } from "./http/middleware/csrf.ts";
import { rateLimit } from "./http/middleware/rate-limit.ts";
import { requireAuth } from "./http/middleware/auth.ts";
import { ipBlocklist } from "./http/middleware/ip-blocklist.ts";
import { EventPublisher } from "./events/event-publisher.ts";
import { AuthRepository } from "./modules/auth/auth.repository.ts";
import { AuthService } from "./modules/auth/auth.service.ts";
import { registerAuthRoutes } from "./modules/auth/auth.controller.ts";
import { UsersService } from "./modules/users/users.service.ts";
import { registerUsersRoutes } from "./modules/users/users.controller.ts";
import { AccountsRepository } from "./modules/accounts/accounts.repository.ts";
import { AccountsService } from "./modules/accounts/accounts.service.ts";
import { registerAccountsRoutes } from "./modules/accounts/accounts.controller.ts";
import { CategoriesRepository } from "./modules/categories/categories.repository.ts";
import { CategoriesService } from "./modules/categories/categories.service.ts";
import { registerCategoriesRoutes } from "./modules/categories/categories.controller.ts";
import { TransactionsRepository } from "./modules/transactions/transactions.repository.ts";
import { TransactionsService } from "./modules/transactions/transactions.service.ts";
import { registerTransactionsRoutes } from "./modules/transactions/transactions.controller.ts";
import { RecurringRepository } from "./modules/recurring/recurring.repository.ts";
import { RecurringService } from "./modules/recurring/recurring.service.ts";
import { registerRecurringRoutes } from "./modules/recurring/recurring.controller.ts";
import { BudgetsRepository } from "./modules/budgets/budgets.repository.ts";
import { BudgetsService } from "./modules/budgets/budgets.service.ts";
import { registerBudgetsRoutes } from "./modules/budgets/budgets.controller.ts";
import { GoalsRepository } from "./modules/goals/goals.repository.ts";
import { GoalsService } from "./modules/goals/goals.service.ts";
import { registerGoalsRoutes } from "./modules/goals/goals.controller.ts";
import { HabitsRepository } from "./modules/habits/habits.repository.ts";
import { HabitsService } from "./modules/habits/habits.service.ts";
import { registerHabitsRoutes } from "./modules/habits/habits.controller.ts";
import { InvestmentsRepository } from "./modules/investments/investments.repository.ts";
import { InvestmentsService } from "./modules/investments/investments.service.ts";
import { registerInvestmentsRoutes } from "./modules/investments/investments.controller.ts";
import { AchievementsRepository } from "./modules/achievements/achievements.repository.ts";
import { AchievementsService } from "./modules/achievements/achievements.service.ts";
import { registerAchievementsRoutes } from "./modules/achievements/achievements.controller.ts";
import { NotificationsRepository } from "./modules/notifications/notifications.repository.ts";
import { NotificationsService } from "./modules/notifications/notifications.service.ts";
import { registerNotificationsRoutes } from "./modules/notifications/notifications.controller.ts";
import { InsightsRepository } from "./modules/insights/insights.repository.ts";
import { InsightsService } from "./modules/insights/insights.service.ts";
import { registerInsightsRoutes } from "./modules/insights/insights.controller.ts";
import type { EmbeddingsService } from "./ai/embeddings.service.ts";
import { evaluateAchievementsAfterMutation } from "./http/middleware/achievement-evaluation.ts";
import { SlidingWindowRateLimiter } from "./shared/utils/rate-limiter.ts";
import { API_VERSION, APP_VERSION } from "./version.ts";

export interface AppDependencies {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
  /** Opcional: sem provider, a busca de insights cai para texto. */
  readonly embeddings?: EmbeddingsService | null;
}

/**
 * Cria a aplicação Hono sem efeitos colaterais de I/O.
 *
 * O banco, a configuração e o logger são injetados — os testes montam a app
 * com um banco temporário em vez de usar um singleton global.
 */
export function createApp({ db, config, logger, embeddings = null }: AppDependencies) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
          details: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
    },
  });

  const startedAt = Date.now();

  app.use("*", requestId);
  app.use("*", async (c, next) => {
    c.set("logger", logger.child({ requestId: c.get("requestId") }));
    await next();
  });
  app.use("*", securityHeaders(config));
  app.use(
    "*",
    cors({
      origin: config.appOrigin,
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-CSRF-Token", "X-Request-Id"],
      exposeHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );
  app.use("*", bodyLimit());
  app.use("*", requestLogger);

  const repository = new AuthRepository(db);
  const rateLimiter = new SlidingWindowRateLimiter();
  const events = new EventPublisher({ db, config, logger });
  const authService = new AuthService({
    db,
    config,
    logger,
    repository,
    rateLimiter,
    events,
  });
  const usersService = new UsersService(repository);

  const accountsRepository = new AccountsRepository(db);
  const accountsService = new AccountsService({
    db,
    repository: accountsRepository,
    preferences: repository,
  });
  const categoriesRepository = new CategoriesRepository(db);
  const categoriesService = new CategoriesService(categoriesRepository);
  const transactionsRepository = new TransactionsRepository(db);
  const transactionsService = new TransactionsService({
    db,
    repository: transactionsRepository,
    accounts: accountsRepository,
    categories: categoriesRepository,
    events,
  });

  const recurringRepository = new RecurringRepository(db);
  const recurringService = new RecurringService({
    db,
    repository: recurringRepository,
    transactions: transactionsRepository,
    accounts: accountsRepository,
    categories: categoriesRepository,
    events,
  });

  const budgetsRepository = new BudgetsRepository(db);
  const budgetsService = new BudgetsService({
    repository: budgetsRepository,
    categories: categoriesRepository,
    preferences: repository,
    events,
  });

  const goalsRepository = new GoalsRepository(db);
  const goalsService = new GoalsService({
    db,
    repository: goalsRepository,
    accounts: accountsRepository,
    preferences: repository,
    events,
  });

  const habitsRepository = new HabitsRepository(db);
  const habitsService = new HabitsService({ db, repository: habitsRepository, events });

  const investmentsRepository = new InvestmentsRepository(db);
  const investmentsService = new InvestmentsService({
    db,
    repository: investmentsRepository,
    accounts: accountsRepository,
    preferences: repository,
    events,
  });

  const notificationsRepository = new NotificationsRepository(db);
  const notificationsService = new NotificationsService(notificationsRepository);

  const insightsRepository = new InsightsRepository(db);
  const insightsService = new InsightsService({
    repository: insightsRepository,
    embeddings,
  });

  const achievementsRepository = new AchievementsRepository(db);
  const achievementsService = new AchievementsService({
    db,
    repository: achievementsRepository,
    notifications: notificationsRepository,
    logger,
  });

  app.use("/api/v1/auth/*", ipBlocklist(db));
  app.use("*", csrfProtection(config));
  app.use("/api/v1/auth/register", rateLimit(rateLimiter, config, { scope: "auth-register" }));
  app.use("/api/v1/auth/login", rateLimit(rateLimiter, config, { scope: "auth-login" }));
  app.use("/api/v1/auth/refresh", rateLimit(rateLimiter, config, { scope: "auth-refresh" }));
  app.use("/api/v1/auth/logout", rateLimit(rateLimiter, config, { scope: "auth-logout" }));
  app.use("/api/v1/me", requireAuth(repository, config));
  app.use("/api/v1/me/*", requireAuth(repository, config));
  app.use("/api/v1/accounts", requireAuth(repository, config));
  app.use("/api/v1/accounts/*", requireAuth(repository, config));
  app.use("/api/v1/categories", requireAuth(repository, config));
  app.use("/api/v1/categories/*", requireAuth(repository, config));
  app.use("/api/v1/transactions", requireAuth(repository, config));
  app.use("/api/v1/transactions/*", requireAuth(repository, config));
  app.use("/api/v1/recurring", requireAuth(repository, config));
  app.use("/api/v1/recurring/*", requireAuth(repository, config));
  app.use("/api/v1/budgets", requireAuth(repository, config));
  app.use("/api/v1/budgets/*", requireAuth(repository, config));
  app.use("/api/v1/goals", requireAuth(repository, config));
  app.use("/api/v1/goals/*", requireAuth(repository, config));
  app.use("/api/v1/habits", requireAuth(repository, config));
  app.use("/api/v1/habits/*", requireAuth(repository, config));
  app.use("/api/v1/habit-triggers", requireAuth(repository, config));
  app.use("/api/v1/habit-triggers/*", requireAuth(repository, config));
  app.use("/api/v1/investments", requireAuth(repository, config));
  app.use("/api/v1/investments/*", requireAuth(repository, config));
  app.use("/api/v1/achievements", requireAuth(repository, config));
  app.use("/api/v1/achievements/*", requireAuth(repository, config));
  app.use("/api/v1/notifications", requireAuth(repository, config));
  app.use("/api/v1/notifications/*", requireAuth(repository, config));
  app.use("/api/v1/insights", requireAuth(repository, config));
  app.use("/api/v1/insights/*", requireAuth(repository, config));

  // Registrado depois dos guards: quando `next()` retorna, `userId` já existe.
  app.use("*", evaluateAchievementsAfterMutation(achievementsService, logger));

  app.openapi(healthRoute, (c) =>
    c.json(
      {
        data: {
          status: "ok" as const,
          version: APP_VERSION,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        },
        meta: { requestId: c.get("requestId") },
      },
      200,
    ));

  app.openapi(readyRoute, (c) => {
    let migrations = 0;
    let databaseOk = true;

    try {
      db.prepare("SELECT 1 AS ok").get();
      migrations = db
        .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")
        .get()?.count ?? 0;
    } catch {
      databaseOk = false;
    }

    const ready = databaseOk;
    const body = {
      data: {
        status: ready ? ("ready" as const) : ("not_ready" as const),
        checks: {
          database: databaseOk ? ("ok" as const) : ("error" as const),
          migrations,
        },
      },
      meta: { requestId: c.get("requestId") },
    };

    return c.json(body, ready ? 200 : 503);
  });

  registerOpenApiDocument(app, config);

  registerAuthRoutes(app, { service: authService, config });
  registerUsersRoutes(app, { service: usersService, config });
  registerAccountsRoutes(app, {
    service: accountsService,
    transactions: transactionsService,
    config,
  });
  registerCategoriesRoutes(app, { service: categoriesService, config });
  registerTransactionsRoutes(app, { service: transactionsService, config });
  registerRecurringRoutes(app, { service: recurringService, config });
  registerBudgetsRoutes(app, { service: budgetsService, config });
  registerGoalsRoutes(app, { service: goalsService, config });
  registerHabitsRoutes(app, { service: habitsService, config });
  registerInvestmentsRoutes(app, { service: investmentsService, config });
  registerAchievementsRoutes(app, { service: achievementsService, config });
  registerNotificationsRoutes(app, { service: notificationsService, config });
  registerInsightsRoutes(app, { service: insightsService, config });

  app.get("/api/docs", swaggerUI({ url: `/api/${API_VERSION}/openapi.json` }));

  app.notFound((c) => toErrorResponse(new AppError("NOT_FOUND", "Rota não encontrada"), c));
  app.onError((error, c) => toErrorResponse(error, c));

  return app;
}
