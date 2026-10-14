// This package is retired in favour of the MCP endpoint built into
// omnigraph-server. The binary keeps working for existing configurations and
// prints this notice once at startup.

export const DEPRECATION_NOTICE =
  '@modernrelay/omnigraph-mcp is deprecated. omnigraph-server serves MCP itself at ' +
  '`<server URL>/mcp` (Streamable HTTP, the same bearer token, the same policy). ' +
  'Point your MCP client there instead: ' +
  'https://github.com/ModernRelay/omnigraph/blob/main/docs/user/operations/mcp.md';
