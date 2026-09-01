export interface ViewStateStore<State> {
  read(): State;
  write(state: State): void;
}

export class InMemoryViewStateStore<State> implements ViewStateStore<State> {
  private constructor(private state: State) {}

  static of<State>(initialState: State): InMemoryViewStateStore<State> {
    return new InMemoryViewStateStore(initialState);
  }

  read(): State {
    return this.state;
  }

  write(state: State): void {
    this.state = state;
  }
}
