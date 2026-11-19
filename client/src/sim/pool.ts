export class ObjectPool<T> {
    private readonly free: T[] = [];
    private readonly factory: () => T;
    private readonly resetFn: (item: T) => void;
    private totalCreated = 0;
  
    constructor(factory: () => T, reset: (item: T) => void, initialCapacity = 0) {
      this.factory = factory;
      this.resetFn = reset;
      for (let i = 0; i < initialCapacity; i++) {
        this.free.push(this.factory());
        this.totalCreated++;
      }
    }
  
    acquire(): T {
      const reused = this.free.pop();
      if (reused !== undefined) {
        this.resetFn(reused);
        return reused;
      }
      this.totalCreated++;
      const created = this.factory();
      this.resetFn(created);
      return created;
    }
  
    release(item: T): void {
      this.free.push(item);
    }
  
    get availableCount(): number {
      return this.free.length;
    }
  
    get createdCount(): number {
      return this.totalCreated;
    }
  }