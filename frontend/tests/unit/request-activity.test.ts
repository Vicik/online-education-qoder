import { useRequestActivityStore } from '@/stores/request-activity';

describe('request-activity', () => {
  beforeEach(() => {
    useRequestActivityStore.setState({ pendingCount: 0 });
  });

  it('start/finish 成对增减，且不会变为负数', () => {
    const store = useRequestActivityStore.getState();
    store.startRequest();
    store.startRequest();
    expect(useRequestActivityStore.getState().pendingCount).toBe(2);
    store.finishRequest();
    expect(useRequestActivityStore.getState().pendingCount).toBe(1);
    store.finishRequest();
    store.finishRequest();
    expect(useRequestActivityStore.getState().pendingCount).toBe(0);
  });
});
