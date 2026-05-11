export class InvalidLlmResponse extends Error {
  constructor(detail) { super(`LLM response invalid: ${detail}`); this.name = 'InvalidLlmResponse'; }
}

export class InvalidLlmMove extends Error {
  constructor(moveId, legalIds) {
    super(`LLM picked moveId '${moveId}' not in legal set [${legalIds.join(', ')}]`);
    this.name = 'InvalidLlmMove';
  }
}
