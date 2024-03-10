import typescript from '@rollup/plugin-typescript';
import { terser } from 'rollup-plugin-terser';

export default {
  input: './src/EchoChamber.ts',
  output: [
    {
      file: 'dist/bundle.js',
      format: 'umd',
      name: 'EchoChamber',
    },
    {
      file: 'dist/bundle.min.js',
      format: 'umd',
      name: 'EchoChamber',
      plugins: [terser()],
    }
  ],
  plugins: [
    typescript(),
  ],
};
