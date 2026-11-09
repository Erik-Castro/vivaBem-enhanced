export type ToastTone = "success" | "error" | "info";

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

let nextId = 1;
let timers = new Map<number, ReturnType<typeof setTimeout>>();

class ToastStore {
  items = $state<Toast[]>([]);

  push(message: string, tone: ToastTone = "info"): void {
    const id = nextId++;
    this.items = [...this.items, { id, message, tone }];

    const timer = setTimeout(() => this.dismiss(id), tone === "error" ? 6000 : 4000);
    timers.set(id, timer);
  }

  success(message: string): void {
    this.push(message, "success");
  }

  error(message: string): void {
    this.push(message, "error");
  }

  dismiss(id: number): void {
    const timer = timers.get(id);

    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }

    this.items = this.items.filter((item) => item.id !== id);
  }
}

export const toasts = new ToastStore();
