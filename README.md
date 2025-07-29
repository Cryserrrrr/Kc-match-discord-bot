# Karmine Corp Discord Bot

A Discord bot that notifies about Karmine Corp matches in League of Legends, Valorant, and Rocket League using the PandaScore API.

## Features

- 🔔 **External match checking** - Check for new matches via command line or external triggers
- 🧠 **Anti-spam mechanism** - Uses PostgreSQL database to prevent duplicate announcements
- 🎮 **Multi-game support** - League of Legends, Valorant, and Rocket League
- ⚙️ **Customizable messages** - Personalize announcement messages with placeholders
- 📊 **Slash commands** - Easy-to-use Discord slash commands

## Commands

- `/ping` - Check if the bot is working
- `/nextmatch` - Show the next Karmine Corp match
- `/setchannel <channel>` - Set the announcement channel (requires Manage Server permission)
- `/setphrase <message>` - Customize the announcement message (requires Manage Server permission)

### External Commands

- `npm run check-matches` - Trigger match checking from command line (external only)
- `node scripts/check-matches.js` - Direct script execution

### Message Placeholders

When customizing the announcement message, you can use these placeholders:

- `{team}` - Opponent team name
- `{hour}` - Match time (HH:MM format)
- `{game}` - Game name

Example: `🔥 La KC affronte {team} à {hour} sur {game} !`

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Discord Bot Token
- PandaScore API Token

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd karmine-corp-bot
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp env.example .env
   ```

   Edit `.env` with your credentials:

   ```env
   DISCORD_TOKEN=your_discord_bot_token
   PANDASCORE_TOKEN=your_pandascore_token
   DATABASE_URL="postgresql://username:password@localhost:5432/karmine_bot"
   CLIENT_ID=your_discord_client_id
   ```

4. **Set up the database**

   ```bash
   npx prisma generate
   npx prisma db push
   ```

5. **Build the project**

   ```bash
   npm run build
   ```

6. **Start the bot**
   ```bash
   npm start
   ```

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section and create a bot
4. Copy the bot token to your `.env` file
5. Go to "OAuth2" > "URL Generator"
6. Select "bot" and "applications.commands" scopes
7. Select the required permissions:
   - Send Messages
   - Use Slash Commands
   - Embed Links
8. Use the generated URL to invite the bot to your server

### PandaScore API Setup

1. Go to [PandaScore](https://pandascore.co/)
2. Create an account and get your API token
3. Add the token to your `.env` file

## Usage

### External Match Checking

The bot supports external match checking via command line:

1. **Set up the announcement channel:**

   ```
   /setchannel #announcements
   ```

2. **Customize the message (optional):**

   ```
   /setphrase 🔥 La KC affronte {team} à {hour} sur {game} !
   ```

3. **Check for new matches via command line:**

   ```bash
   npm run check-matches
   ```

   Or directly:

   ```bash
   node scripts/check-matches.js
   ```

The script will:

- Connect to Discord and the database
- Fetch matches from PandaScore API
- Check for new matches not yet announced
- Send announcements to configured channels
- Update the database to mark matches as announced
- Exit cleanly

### Integration with External Systems

You can integrate the match checking with:

- **Cron jobs** (Linux/macOS):

  ```bash
  */30 * * * * cd /path/to/bot && npm run check-matches
  ```

- **Task Scheduler** (Windows):

  ```cmd
  npm run check-matches
  ```

- **Coolify Cron Jobs**:
  ```bash
  npm run check-matches
  ```

## Deployment

### Coolify Deployment (Recommended)

1. **Push your code to a Git repository**

2. **In Coolify dashboard:**

   - Create a new application
   - Connect your Git repository
   - Set build method to "Dockerfile"
   - Add environment variables:
     ```
     DISCORD_TOKEN=your_discord_bot_token
     PANDASCORE_TOKEN=your_pandascore_token
     DATABASE_URL=your_postgresql_connection_string
     CLIENT_ID=your_discord_client_id
     NODE_ENV=production
     ```

3. **Set up Cron Job in Coolify:**

   - Create a new cron job
   - Command: `npm run check-matches`
   - Schedule: `*/30 * * * *` (every 30 minutes)
   - Working directory: `/app`

4. **Deploy the application**

The bot will:

- Build using the provided Dockerfile
- Start and wait for external triggers
- Run match checks via cron job every 30 minutes
- Restart automatically if it crashes
- Provide health checks

### Manual Deployment (VPS)

1. **Upload files to your VPS**
2. **Install Node.js and PostgreSQL**
3. **Set up environment variables**
4. **Install dependencies**: `npm install --production`
5. **Set up the database**: `npx prisma db push`
6. **Build the project**: `npm run build`
7. **Start the bot**: `npm start`
8. **Set up cron job**:
   ```bash
   crontab -e
   # Add: */30 * * * * cd /path/to/bot && npm run check-matches
   ```

### Process Management

Use PM2 to keep the bot running:

```bash
npm install -g pm2
pm2 start dist/index.js --name "karmine-bot"
pm2 save
pm2 startup
```

## Development

```bash
# Run in development mode
npm run dev

# Generate Prisma client
npm run db:generate

# Push database changes
npm run db:push

# Open Prisma Studio
npm run db:studio

# Test match checking
npm run check-matches
```

## Database Schema

### Match Table

- `id` - PandaScore match ID (primary key)
- `game` - Game type (lol, valorant, rocket_league)
- `opponent` - Opponent team name
- `beginAt` - Match start time
- `announced` - Whether the match has been announced
- `createdAt` - Record creation timestamp

### Guild Settings Table

- `guildId` - Discord guild ID (primary key)
- `channelId` - Announcement channel ID
- `customMessage` - Custom announcement message

## Troubleshooting

### Common Issues

1. **Bot not responding to commands**

   - Check if the bot has the required permissions
   - Verify the CLIENT_ID in your .env file
   - Ensure slash commands are registered

2. **Database connection errors**

   - Verify your DATABASE_URL format
   - Check if PostgreSQL is running
   - Ensure the database exists

3. **No match announcements**

   - Check PandaScore API token
   - Verify the bot has permission to send messages in the channel
   - Check bot logs for API errors
   - Test with `npm run check-matches`

4. **External script errors**
   - Ensure the project is built: `npm run build`
   - Check environment variables are set
   - Verify database connection

### Logs

The bot logs all activities to the console. Check for:

- `[INFO]` - Normal operations
- `[ERROR]` - Errors that need attention
- `[WARN]` - Warnings about potential issues

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details
