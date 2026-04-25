import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../spec/openapi.json',
  output: {
    path: 'src/generated',
    postProcess: ['prettier'],
  },
  plugins: ['@hey-api/typescript'],
});
