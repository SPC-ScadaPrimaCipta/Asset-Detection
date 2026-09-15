#!/bin/bash

# Start detection worker (BullMQ consumer)
# Run this in a separate terminal alongside `npm run dev`

echo "Starting detection worker..."
echo "Make sure PostgreSQL and Redis are running."
echo ""
echo "Worker will process /api/detection/jobs queue."
echo "Press Ctrl+C to stop."
echo ""

# Env vars loaded by workers/preload.ts (.env.local); no shell export needed.

# Run worker (connects to Redis, listens for jobs)
npm run worker
