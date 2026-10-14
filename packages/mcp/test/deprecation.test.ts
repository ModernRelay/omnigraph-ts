import { describe, expect, it } from 'vitest';
import { DEPRECATION_NOTICE } from '../src/index';

describe('deprecation', () => {
  it('points at the server MCP endpoint and its guide', () => {
    expect(DEPRECATION_NOTICE).toContain('deprecated');
    expect(DEPRECATION_NOTICE).toContain('/mcp');
    expect(DEPRECATION_NOTICE).toContain('docs/user/operations/mcp.md');
  });
});
