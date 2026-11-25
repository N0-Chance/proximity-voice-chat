# Third-party notices

The microphone cleanup uses RNNoise, a noise filter and speech detector. Its compiled form, `scripts/vendor/rnnoise/rnnoise.wasm`, is included unchanged. Nothing else in this module comes from third parties.

## RNNoise

- **What it is:** a speech-trained noise filter by Jean-Marc Valin and the Xiph.Org Foundation: <https://github.com/xiph/rnnoise>.
- **Where the file comes from:** the WebAssembly build in the npm package `@shiguredo/rnnoise-wasm`, version 2025.1.5 (<https://github.com/shiguredo/rnnoise-wasm>). The package embeds the file in its JavaScript; I took the file out of it as it is and don't use the package's JavaScript.
- **SHA-256 of the file:** `b3b67c9eae8f0791aad468c708659e0850bb37b0fb9c8a8666f2d7b0b6869bc4`

### Licences

- **RNNoise:** the revised (3-clause) BSD licence. The full text is in `scripts/vendor/rnnoise/COPYING-rnnoise.txt`.
  - Copyright (c) 2007-2017, 2024 Jean-Marc Valin
  - Copyright (c) 2023 Amazon
  - Copyright (c) 2017, Mozilla
  - Copyright (c) 2005-2017, Xiph.Org Foundation
  - Copyright (c) 2003-2004, Mark Borgerding
- **The WebAssembly build:** the Apache License 2.0, by Shiguredo Inc. The full text is in `scripts/vendor/rnnoise/LICENSE-rnnoise-wasm.txt`.

These licences cover the RNNoise file only. They don't change the terms of the rest of this module.
