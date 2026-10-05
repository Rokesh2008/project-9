module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
};
