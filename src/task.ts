



export interface Task<C extends unknown = unknown, R extends Promise<unknown> = Promise<unknown>> {
  (context: C): R 
}

