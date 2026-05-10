export class FakeLlmClient {
  constructor(responses = []) {
    this._responses = responses.slice();
    this.calls = [];
  }

  async send(args) {
    this.calls.push(args);
    if (this._responses.length === 0) throw new Error('FakeLlmClient: response queue exhausted');
    const next = this._responses.shift();
    if (next.throw) throw next.throw;
    return {
      text: next.text,
      sessionId: next.sessionId ?? null,
      inputTokens: null,
      outputTokens: null,
    };
  }

  pushResponse(r) { this._responses.push(r); }
}
