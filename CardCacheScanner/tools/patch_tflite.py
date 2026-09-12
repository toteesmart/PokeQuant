from pathlib import Path

def main() -> None:
    path = Path('node_modules/react-native-fast-tflite/cpp/HybridTfliteModule.cpp')
    src = path.read_text(encoding='utf-8')

    # Add include for ArrayBuffer
    if '#include <NitroModules/ArrayBuffer.hpp>' not in src:
        src = src.replace(
            '#include "HybridTfliteModule.hpp"\n#include "TfliteHelpers.hpp"',
            '#include "HybridTfliteModule.hpp"\n#include "TfliteHelpers.hpp"\n#include <NitroModules/ArrayBuffer.hpp>',
        )

    # Patch createModel to copy model data into a native-owned buffer
    old = '''HybridTfliteModule::createModel(const std::shared_ptr<ArrayBuffer>& modelData,
                                const std::vector<TensorflowModelDelegate>& delegates) {
  TfLiteModel* model = TfLiteModelCreate(modelData->data(), modelData->size());'''
    new = '''HybridTfliteModule::createModel(const std::shared_ptr<ArrayBuffer>& modelData,
                                const std::vector<TensorflowModelDelegate>& delegates) {
  // Copy bundled JS ArrayBuffer into a native-owned buffer so the TFLite interpreter
  // can safely read model weights from any thread (invoke runs on a Nitro thread).
  std::shared_ptr<ArrayBuffer> nativeModelData = ArrayBuffer::copy(modelData);
  TfLiteModel* model = TfLiteModelCreate(nativeModelData->data(), nativeModelData->size());'''
    src = src.replace(old, new)

    # Use the native copy in the HybridTfliteModel so it stays alive
    src = src.replace(
        'std::make_shared<HybridTfliteModel>(interpreter, modelData, delegates)',
        'std::make_shared<HybridTfliteModel>(interpreter, nativeModelData, delegates)',
    )

    path.write_text(src, encoding='utf-8')
    print('Patched', path)


if __name__ == '__main__':
    main()
