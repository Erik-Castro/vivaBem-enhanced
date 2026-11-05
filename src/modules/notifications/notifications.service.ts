import { AppError } from "../../http/errors.ts";
import type {
  ListNotificationsOptions,
  Notification,
  NotificationPage,
  NotificationsRepository,
} from "./notifications.repository.ts";

export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  list(userId: string, options: ListNotificationsOptions): NotificationPage {
    return this.repository.list(userId, options);
  }

  unreadCount(userId: string): number {
    return this.repository.countUnread(userId);
  }

  markRead(userId: string, id: string): Notification {
    const notification = this.repository.markRead(userId, id);
    if (notification === null) {
      throw new AppError("NOT_FOUND", "Notificação não encontrada");
    }
    return notification;
  }

  markAllRead(userId: string): number {
    return this.repository.markAllRead(userId);
  }
}
