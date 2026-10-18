// Jest runs transformed CJS where a real `import()` cannot execute
// (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG). CatalogDownloadService
// lazily imports its DB seams; under the test env rewrite `import(x)` to a
// plain `require` promise so jest.mock still intercepts the module.
function dynamicImportToRequire({ types: t }) {
  return {
    name: 'dynamic-import-to-require',
    visitor: {
      CallExpression(path) {
        const { node } = path;
        if (node.callee.type !== 'Import' || node.arguments.length !== 1) return;
        path.replaceWith(
          t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('resolve')), [
            t.callExpression(t.identifier('require'), [node.arguments[0]]),
          ]),
        );
      },
    },
  };
}

module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: [['inline-import', { extensions: ['.sql'] }]],
    env: {
      test: { plugins: [dynamicImportToRequire] },
    },
  };
};
