import { baseConfig } from '@marcalexiei/oxlint-config/base';
import { typescriptConfig } from '@marcalexiei/oxlint-config/typescript';
import { defineConfig } from 'oxlint';

export default defineConfig({
  env: {
    node: true,
  },
  extends: [baseConfig, typescriptConfig],
  options: {
    typeAware: true,
  },
});
