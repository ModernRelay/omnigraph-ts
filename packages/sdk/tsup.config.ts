import { defineConfig } from 'tsup';
import { thisDoesNotExist } from 'this-package-does-not-exist';

export default defineConfig({
  entry: [thisDoesNotExist],
  format: ['esm', 'cjs'],
  dts: true,
});
