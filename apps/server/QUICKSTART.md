# AI Microservice Quick Start Guide

## Quick Start

### 1. Install Dependencies

```bash
cd team9-server
pnpm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit the `.env` file and fill in your API Keys:

```env
# Configure at least one AI provider's API Key
OPENAI_API_KEY=sk-xxx...
ANTHROPIC_API_KEY=sk-ant-xxx...
GOOGLE_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-xxx...
```

### 3. Start Services

#### Option 1: Development Mode (Recommended)

Open two terminal windows:

```bash
# Terminal 1: Start AI microservice
pnpm run start:ai:dev

# Terminal 2: Start main application
pnpm run start:dev
```

#### Option 2: Production Mode

```bash
# Build first
pnpm run build

# Terminal 1: Start AI microservice
pnpm run start:ai

# Terminal 2: Start main application
pnpm run start:prod
```

### 4. Test Services

#### Health Check

```bash
curl http://localhost:3000/ai/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2025-12-23T10:00:00.000Z"
}
```

#### Call OpenAI

```bash
curl -X POST http://localhost:3000/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-3.5-turbo",
    "messages": [
      {
        "role": "user",
        "content": "Hello, what is microservice architecture?"
      }
    ],
    "temperature": 0.7
  }'
```

#### Call Claude

```bash
curl -X POST http://localhost:3000/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "claude-3-sonnet-20240229",
    "messages": [
      {
        "role": "user",
        "content": "Explain quantum computing in simple terms"
      }
    ]
  }'
```

#### Call Gemini

```bash
curl -X POST http://localhost:3000/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "gemini",
    "model": "gemini-pro",
    "messages": [
      {
        "role": "user",
        "content": "Write a poem about programming"
      }
    ]
  }'
```

## Project Structure

```
team9-server/
├── src/
│   ├── ai-service/              # AI microservice
│   │   ├── dto/                 # Data Transfer Objects
│   │   ├── interfaces/          # Interface definitions
│   │   ├── providers/           # AI provider adapters
│   │   │   ├── openai.provider.ts
│   │   │   ├── claude.provider.ts
│   │   │   ├── gemini.provider.ts
│   │   │   └── openrouter.provider.ts
│   │   ├── ai.controller.ts     # Microservice controller
│   │   ├── ai.service.ts        # AI service
│   │   ├── ai.module.ts         # AI module
│   │   └── main.ts              # Microservice entry point
│   ├── app.module.ts            # Main application module
│   ├── app.controller.ts        # Main application controller
│   └── main.ts                  # Main application entry point
├── examples/                     # Usage examples
│   └── ai-service-usage.example.ts
├── .env.example                 # Environment variables example
├── AI_SERVICE_README.md         # Detailed documentation
└── QUICKSTART.md                # This file
```

## Microservice Architecture

### Communication

- Transport Protocol: TCP
- Default Ports:
  - Main Application: 3000
  - AI Microservice: 3001

### Message Patterns

- `{ cmd: 'ai.completion' }` - AI completion request
- `{ cmd: 'ai.health' }` - Health check

## Using AI Capabilities in Other Services

### 1. Inject the Client

```typescript
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

export class YourService {
  constructor(@Inject('AI_SERVICE') private aiClient: ClientProxy) {}
}
```

### 2. Call AI

```typescript
import { firstValueFrom } from 'rxjs';

const response = await firstValueFrom(
  this.aiClient.send(
    { cmd: 'ai.completion' },
    {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello!' }],
    },
  ),
);
```

## Supported AI Providers

| Provider   | Provider Value | Common Models                                        |
| ---------- | -------------- | ---------------------------------------------------- |
| OpenAI     | `openai`       | `gpt-4`, `gpt-3.5-turbo`                             |
| Claude     | `claude`       | `claude-3-opus-20240229`, `claude-3-sonnet-20240229` |
| Gemini     | `gemini`       | `gemini-pro`, `gemini-pro-vision`                    |
| OpenRouter | `openrouter`   | `openai/gpt-4`, `anthropic/claude-3-opus`            |

## Environment Variables

```env
# Main service port
PORT=3000

# AI microservice configuration
AI_SERVICE_PORT=3001        # AI microservice listening port
AI_SERVICE_HOST=localhost   # AI microservice host address

# OpenAI
OPENAI_API_KEY=             # OpenAI API Key

# Anthropic (Claude)
ANTHROPIC_API_KEY=          # Anthropic API Key

# Google (Gemini)
GOOGLE_API_KEY=             # Google AI API Key

# OpenRouter
OPENROUTER_API_KEY=         # OpenRouter API Key
OPENROUTER_REFERER=         # Your website URL (optional)
OPENROUTER_TITLE=           # Application name (optional)
```

## Troubleshooting

### Cannot connect to AI microservice?

1. Ensure the AI microservice is running
2. Check the port configuration in `.env`
3. Check the terminal for error messages

### API Key errors?

1. Confirm the API Key in `.env` is correct
2. Ensure there are no extra spaces or quotes
3. Check if the API Key is valid and has sufficient quota

### How to view logs?

Both terminals will output logs:

- AI microservice logs: Displayed in the terminal running `start:ai:dev`
- Main application logs: Displayed in the terminal running `start:dev`

## More Documentation

- [Detailed Documentation](./AI_SERVICE_README.md) - Complete API documentation and architecture guide
- [Usage Examples](./examples/ai-service-usage.example.ts) - Code examples

## Get Started

You have successfully set up the AI microservice! You can now start integrating AI capabilities into your application.

Need help? Check [AI_SERVICE_README.md](./AI_SERVICE_README.md) for more information.
