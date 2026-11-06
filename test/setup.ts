// Automated tests must never invoke a developer's live local model or hosted endpoint.
process.env.LOCAL_AI_ENABLED = 'false';
