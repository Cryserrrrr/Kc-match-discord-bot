# Karmine Corp Discord Bot

A Discord bot that automatically notifies about Karmine Corp matches in League of Legends, Valorant and Rocket League using the PandaScore API.

## 🚀 Features

- 🔔 **Automatic notifications** - Automatic announcements of daily matches
- ⏰ **Pre-match notifications** - Alerts 30 minutes before each match
- 🎮 **Multi-game support** - League of Legends, Valorant and Rocket League
- ⚙️ **Complete configuration** - Integrated configuration interface
- 🏆 **Team filtering** - Choose which teams to announce
- 📊 **Slash commands** - Modern and intuitive Discord interface
- 🏆 **Tournament standings** - View tournament rankings and brackets
- 💾 **Smart caching** - 5-minute cache to prevent API spam
- 📈 **Usage statistics** - Track command usage and performance metrics
- 🎫 **Support ticket system** - Create and manage support tickets
- 💬 **DM support** - Most commands work in private messages
- 🎉 **Welcome messages** - Automatic welcome when bot is added to server
- 🔧 **Advanced analytics** - Team popularity tracking and performance monitoring

## 📋 Commands

### Discord Commands

- `/nextmatch` - Show the next Karmine Corp match
- `/standing` - Show tournament standings or brackets for a team
- `/ticket` - Create a support ticket (bug report or feature request)
- `/mytickets` - View your personal support tickets
- `/config` - Complete bot configuration (server management permissions required)

### Maintenance Scripts

- `npm run get-matches` - Fetch new matches from PandaScore
- `npm run check-matches` - Check and announce matches for the next 24h
- `npm run check-upcoming-matches` - Check matches in the next 30-35 minutes
- `npm run update-guild-stats` - Update guild statistics and clean old data

## ⚙️ Setup

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Discord Bot Token
- PandaScore API Token

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd Kc-match-discord-bot
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   ```bash
   cp env.example .env
   ```

   Edit `.env` with your credentials

4. **Set up the database**

   ```bash
   npx prisma migrate dev --name init
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
   - Attach Files
   - View Audit Log (for welcome messages)
   - Mention Everyone (for notifications)
   - Manage Messages (for notifications)
8. Use the generated URL to invite the bot to your server

### PandaScore API Setup

1. Go to [PandaScore](https://pandascore.co/)
2. Create an account and get your API token
3. Add the token to your `.env` file

## 🎯 Usage

### Discord Configuration

```
/config
```

1. **Set up the announcement channel:**

   Select "📺 Announcement Channel"

2. **Configure roles to ping (optional):**

   Select "👥 Rôles à mentionner" to choose which roles should be mentioned in announcements.

3. **Filter teams (optional):**

   Select "🏆 Team Filter"

4. **Enable pre-match notifications (optional):**

   Select "🔔 Pre-match Notifications"

5. **Enable result notifications (optional):**

   Select "🏆 Score Notifications"

### Support System

#### Creating a ticket

```
/ticket type:bug
```

- Choose between "🐛 Bug" or "💡 Amélioration"
- Fill in the description modal
- Receive confirmation via DM

#### Viewing your tickets

```
/mytickets
```

- View all your personal tickets
- See status updates and responses
- Works in both servers and DMs

### DM Support

Most commands work in private messages (DMs):

- ✅ `/nextmatch` - View next matches
- ✅ `/standing` - View tournament standings
- ✅ `/ticket` - Create support tickets
- ✅ `/mytickets` - View your tickets
- ❌ `/config` - Server configuration only

### Supported Teams

- **KC (LEC)** - Main League of Legends team
- **KCB (LFL)** - Academy League of Legends team
- **KCBS (LFL2)** - LFL2 League of Legends team
- **KC Valorant** - Main Valorant team
- **KCGC Valorant** - Game Changers Valorant team
- **KCBS Valorant** - Academy Valorant team
- **KC Rocket League** - Rocket League team

## 📊 Statistics & Analytics

The bot automatically tracks:

### Command Usage

- Number of commands executed per server and globally
- Most popular commands
- User activity patterns

### Performance Metrics

- Response times for each command
- Error rates and types
- Success/failure statistics

### Team Popularity

- Most requested teams in commands
- Usage trends over time
- Popular team combinations

### Server Analytics

- Server member counts
- Active server statistics
- Configuration usage patterns

## 🔄 Retry System

The bot includes a robust retry system with exponential backoff:

- **5 maximum attempts** by default
- **Progressive delays**: 2s → 4s → 8s → 16s → 32s → 60s max
- **Detailed logs** to diagnose issues
- **Maximum resilience** against network timeouts

## 🎉 Welcome System

When the bot is added to a server:

1. **Automatic database entry** - Creates server configuration
2. **Welcome message** - Sends setup instructions
3. **Permission detection** - Adapts to available permissions
4. **Fallback system** - Works even without audit log permissions

### Welcome Message Features

- **DM to user** who added the bot (if audit log available)
- **Server channel fallback** if DM not possible
- **Complete setup guide** with all commands
- **Configuration instructions**

## 🚀 Deployment

### Manual Deployment (VPS)

1. **Upload files to your VPS**
2. **Install Node.js and PostgreSQL**
3. **Configure environment variables**
4. **Install dependencies**: `npm install --production`
5. **Set up the database**: `npx prisma migrate dev --name init`
6. **Build the project**: `npm run build`
7. **Start the bot**: `npm start`
8. **Set up cron jobs**:
   ```bash
   crontab -e
   # Add:
   */30 * * * * cd /path/to/bot && npm run get-matches
   0 10 * * * cd /path/to/bot && npm run check-matches
   */5 * * * * cd /path/to/bot && npm run check-upcoming-matches
   0 2 * * * cd /path/to/bot && npm run update-guild-stats
   ```

## 🛠️ Development

```bash
# Run in development mode
npm run dev

# Generate Prisma client
npx prisma migrate dev --name init

# Test match fetching
npm run get-matches

# Test announcements
npm run check-matches

# Test pre-match notifications
npm run check-upcoming-matches

# Update guild statistics
npm run update-guild-stats
```

## 🔧 Troubleshooting

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

4. **Script errors**

   - Ensure the project is built: `npm run build`
   - Check environment variables are set
   - Verify database connection

5. **Welcome message not sent**

   - Check if bot has "View Audit Log" permission
   - Verify bot can send messages in server channels
   - Check logs for permission errors

6. **DM commands not working**
   - Ensure commands are properly deployed
   - Check bot has necessary intents
   - Verify user has enabled DMs from server members

### Logs

The bot logs all activities to the console. Check for:

- `[INFO]` - Normal operations
- `[ERROR]` - Errors requiring attention
- `[WARN]` - Warnings about potential issues

## 📈 Performance Monitoring

The bot includes comprehensive performance monitoring:

### Metrics Tracked

- **Command execution times**
- **API response times**
- **Database query performance**
- **Memory usage patterns**
- **Error frequency and types**

### Optimization Features

- **Smart caching** for tournament data
- **Connection pooling** for database
- **Rate limiting** for API calls
- **Automatic cleanup** of old data

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 Legal

- [Terms of Service](docs/terms/index.html)
- [Privacy Policy](docs/privacy/index.html)

## 📞 Support

For support, use the `/ticket` command in Discord or contact us via email.
