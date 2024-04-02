import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.jsx'],
  format: ['cjs', 'esm'],
  splitting: false,
  sourcemap: true,
  clean: true
});
