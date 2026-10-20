// Tests never read a developer's .env: the repository root may hold real API keys. Tests that
// check the loading pass their own environment object, which does not carry this switch.
process.env.AIQA_NO_ENV_FILE = "1";
