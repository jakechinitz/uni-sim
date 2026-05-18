// Trivial pub/sub for cross-module notification.

type Handler<T> = (payload: T) => void;

export class Bus {
  private map = new Map<string, Set<Handler<any>>>();

  on<T>(name: string, fn: Handler<T>): () => void {
    let set = this.map.get(name);
    if (!set) { set = new Set(); this.map.set(name, set); }
    set.add(fn as Handler<any>);
    return () => set!.delete(fn as Handler<any>);
  }

  emit<T>(name: string, payload?: T): void {
    const set = this.map.get(name);
    if (!set) return;
    for (const fn of set) fn(payload as T);
  }
}

export const bus = new Bus();
