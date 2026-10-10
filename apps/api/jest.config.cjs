module.exports = {
  preset: 'ts-jest',
  setupFilesAfterEnv: ['<rootDir>/test/safe-test-database.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
};
