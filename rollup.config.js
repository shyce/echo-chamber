import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

const isProduction = process.env.NODE_ENV === "production";

export default {
  input: "src/EchoChamber.ts",
  output: [
    {
      file: "dist/EchoChamber.cjs.js",
      format: "cjs",
      sourcemap: true,
    },
    {
      file: "dist/EchoChamber.esm.js",
      format: "esm",
      sourcemap: true,
    },
  ],
  plugins: [
    typescript(),
    commonjs(),
    isProduction && terser(),
  ],
};