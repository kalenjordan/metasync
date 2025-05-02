# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
- **Run tool**: `node run.js [options]`
- **Install dependencies**: `npm install`
- **Start application**: `npm start`

## Code Style
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Classes**: Use ES6 class syntax with static methods where appropriate
- **Error Handling**: Use try/catch blocks with consola for logging errors
- **Formatting**: 2-space indentation, semi-colons required
- **GraphQL**: Use #graphql comment tag for template literals
- **Asynchronous**: Use async/await pattern with proper error handling
- **Validation**: Validate inputs early with descriptive error messages
- **Logging**: Use consola.info/warn/error for consistent logging
- **Strategy Pattern**: Implement new resource types using Strategy pattern

## Project Structure
- `run.js`: Main entry point for CLI tool
- `strategies/`: Contains sync strategy implementations
- `shopifyClientWrapper.js`: Wrapper for Shopify API client

## Development
- All GraphQL queries should follow existing patterns
- Update README.md when adding/changing functionality
- Ensure backward compatibility with existing command options