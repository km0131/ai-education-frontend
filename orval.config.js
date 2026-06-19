module.exports = {
  educationApi: {
    input: '../openapi/schema.yaml',
    output: {
      mode: 'tags-split',
      target: 'src/api/generated/education.ts',
      schemas: 'src/api/generated/model',
      client: 'react-query', // ここで TanStack Query 用を生成指定
      httpClient: 'axios',
      override: {
        mutator: {
          path: 'src/api/axios-instance.ts',
          name: 'customInstance',
        },
      },
    },
  },
};