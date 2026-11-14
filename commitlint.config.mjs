export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // El historial del proyecto usa la clave Jira como alcance: docs(SCRUM-121): ...
    'scope-case': [0],
  },
};
