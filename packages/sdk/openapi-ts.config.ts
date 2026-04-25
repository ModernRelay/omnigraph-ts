import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../spec/openapi.json',
  output: {
    path: 'src/generated',
    format: 'prettier',
    lint: false,
  },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
  ],
});
