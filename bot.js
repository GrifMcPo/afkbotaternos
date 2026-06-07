// ============================================
// 🤖 ATERNOS БОТ — AFK PROTECTION
// Работает через GitHub Actions 24/7
// ============================================

const mineflayer = require('mineflayer');
const vec3 = require('vec3');
const fs = require('fs');

// ========== НАСТРОЙКИ (МЕНЯЙ ЗДЕСЬ) ==========
const CONFIG = {
    host: 'grifmcpro.aternos.me',  // Твой IP / домен Aternos
    port: 25565,                    // Порт (обычно 25565)
    username: 'GrifBot',            // Ник бота
    password: 'botpassword123',     // Пароль (если сервер кракед — оставь пустым)
    version: '1.20.4',              // Версия Minecraft
    opChat: true,                   // Писать в /opchat?
    checkInterval: 60000,           // Проверка каждые 60 секунд
    moveInterval: 30000,            // Двигать бота каждые 30 секунд
    logFile: 'bot_log.json'         // Файл с логами (расстояние, время)
};

// ========== ПЕРЕМЕННЫЕ ==========
let bot = null;
let startTime = Date.now();
let totalDistance = 0;
let lastPos = null;
let reconnectAttempts = 0;
let moving = false;
let walkingTimer = null;
let pathIndex = 0;

// Ленивые точки для ходьбы (чтобы не спамить одним местом)
const waypoints = [
    {x: 0, y: 64, z: 0},
    {x: 5, y: 64, z: 0},
    {x: 5, y: 64, z: 5},
    {x: 0, y: 64, z: 5},
    {x: -5, y: 64, z: 5},
    {x: -5, y: 64, z: 0},
    {x: -5, y: 64, z: -5},
    {x: 0, y: 64, z: -5},
    {x: 5, y: 64, z: -5}
];

// ========== ЗАГРУЗКА / СОХРАНЕНИЕ ЛОГОВ ==========
function loadLogs() {
    try {
        if (fs.existsSync(CONFIG.logFile)) {
            const data = JSON.parse(fs.readFileSync(CONFIG.logFile));
            totalDistance = data.totalDistance || 0;
            startTime = data.startTime || Date.now();
            console.log(`📂 Загружено: пройдено ${totalDistance.toFixed(1)} м, время в игре ${formatTime(Date.now() - startTime)}`);
        }
    } catch(e) {}
}

function saveLogs() {
    try {
        const logs = {
            totalDistance: totalDistance,
            startTime: startTime,
            lastUpdate: Date.now()
        };
        fs.writeFileSync(CONFIG.logFile, JSON.stringify(logs, null, 2));
    } catch(e) {}
}

// ========== ФОРМАТИРОВАНИЕ ВРЕМЕНИ ==========
function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}ч ${minutes}м ${secs}с`;
}

// ========== ОТПРАВКА СТАТИСТИКИ В ЧАТ ==========
async function sendStats() {
    if (!bot || !bot.player) return;
    
    const elapsed = Date.now() - startTime;
    const timeStr = formatTime(elapsed);
    
    const statsMsg = `§e[GrifBot] §7Статистика бота: §fВремя в игре §a${timeStr} §7| Пройдено §a${totalDistance.toFixed(1)}§7 м`;
    
    if (CONFIG.opChat) {
        bot.chat(`/opchat ${statsMsg}`);
    } else {
        bot.chat(statsMsg);
    }
    
    console.log(`📊 ${statsMsg}`);
}

// ========== ДВИЖЕНИЕ БОТА (ЧТОБЫ НЕ КИКНУЛИ) ==========
function startWalking() {
    if (moving || !bot || !bot.entity) return;
    
    moving = true;
    const waypoint = waypoints[pathIndex % waypoints.length];
    const target = vec3(waypoint.x, waypoint.y, waypoint.z);
    
    bot.once('goal_reached', () => {
        moving = false;
        pathIndex++;
        
        // Обновляем расстояние
        if (lastPos) {
            const dx = bot.entity.position.x - lastPos.x;
            const dz = bot.entity.position.z - lastPos.z;
            const moved = Math.sqrt(dx*dx + dz*dz);
            if (moved > 0.5) {
                totalDistance += moved;
                saveLogs();
                console.log(`🚶 Пройдено +${moved.toFixed(1)} м, всего: ${totalDistance.toFixed(1)} м`);
            }
        }
        lastPos = {x: bot.entity.position.x, z: bot.entity.position.z};
        
        // Периодически показываем статистику в чат (раз в 10 движений)
        if (pathIndex % 10 === 0) {
            sendStats();
        }
    });
    
    bot.pathfinder.setGoal(new goalBlocks(target));
    
    setTimeout(() => {
        if (moving) {
            moving = false;
            bot.pathfinder.setGoal(null);
            startWalking();
        }
    }, 15000);
}

// ========== ПОДКЛЮЧЕНИЕ К СЕРВЕРУ ==========
function connect() {
    console.log(`🔌 Подключение к ${CONFIG.host}:${CONFIG.port}...`);
    
    const options = {
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.username,
        version: CONFIG.version
    };
    
    if (CONFIG.password) {
        options.password = CONFIG.password;
    }
    
    bot = mineflayer.createBot(options);
    
    bot.on('login', () => {
        console.log(`✅ Бот ${CONFIG.username} зашёл на сервер!`);
        reconnectAttempts = 0;
        loadLogs();
        
        // Запускаем периодическое движение
        walkingTimer = setInterval(() => {
            if (!moving) startWalking();
        }, CONFIG.moveInterval);
        
        // Периодическая проверка статуса
        setInterval(() => {
            if (bot && bot.player) {
                console.log(`❤️ Здоровье: ${bot.player.health}, Еда: ${bot.player.food}`);
            }
        }, CONFIG.checkInterval);
        
        // Отправляем приветствие в /opchat
        setTimeout(() => {
            const welcomeMsg = `§a[GrifBot] §7Бот запущен! Время в игре: §a${formatTime(Date.now() - startTime)}§7, пройдено: §a${totalDistance.toFixed(1)}§7 м`;
            if (CONFIG.opChat) {
                bot.chat(`/opchat ${welcomeMsg}`);
            } else {
                bot.chat(welcomeMsg);
            }
        }, 3000);
    });
    
    bot.on('spawn', () => {
        console.log('📍 Бот появился в мире');
        lastPos = {x: bot.entity.position.x, z: bot.entity.position.z};
        startWalking();
    });
    
    bot.on('chat', (username, message) => {
        if (username === CONFIG.username) return;
        
        const lowerMsg = message.toLowerCase();
        
        // Ответ на команду /stats (если кто-то спросит статистику)
        if (lowerMsg.includes('бот') && (lowerMsg.includes('стат') || lowerMsg.includes('stat'))) {
            const elapsed = Date.now() - startTime;
            const response = `§e[GrifBot] §7Статистика: §a${formatTime(elapsed)} §7в игре, пройдено §a${totalDistance.toFixed(1)}§7 м`;
            if (CONFIG.opChat) {
                bot.chat(`/opchat ${response}`);
            } else {
                bot.chat(response);
            }
        }
        
        // Ответ на приветствие
        if (lowerMsg.includes('привет бот') || lowerMsg.includes('hi bot')) {
            setTimeout(() => {
                if (CONFIG.opChat) {
                    bot.chat(`/opchat §a[GrifBot] §7Привет, ${username}!`);
                } else {
                    bot.chat(`Привет, ${username}!`);
                }
            }, 1000);
        }
    });
    
    bot.on('error', (err) => {
        console.error('❌ Ошибка:', err);
    });
    
    bot.on('end', (reason) => {
        console.log(`🔴 Отключён: ${reason}`);
        clearInterval(walkingTimer);
        moving = false;
        
        reconnectAttempts++;
        const delay = Math.min(30000, reconnectAttempts * 5000);
        console.log(`🔄 Переподключение через ${delay/1000} сек...`);
        
        setTimeout(() => {
            connect();
        }, delay);
    });
    
    bot.on('kicked', (reason) => {
        console.log(`👢 Кикнут: ${reason}`);
        setTimeout(() => connect(), 10000);
    });
}

// ========== ЗАПУСК ==========
loadLogs();
connect();

// Сохраняем логи при выходе
process.on('SIGINT', () => {
    saveLogs();
    console.log('👋 Бот остановлен, логи сохранены');
    process.exit();
});
