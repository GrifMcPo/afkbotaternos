// ============================================
// 🤖 ATERNOS БОТ — AFK PROTECTION
// Исправлена версия: без киков
// ============================================

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const vec3 = require('vec3');
const fs = require('fs');

const goalBlocks = goals.GoalBlock;

// ========== НАСТРОЙКИ ==========
const CONFIG = {
    host: 'botcreatortest.aternos.me',
    port: 23209,
    username: 'GrifMcBot',
    password: '',
    version: '1.20.4',
    moveInterval: 45000,        // Движение каждые 45 секунд
    logFile: 'bot_log.json'
};

// ========== ПЕРЕМЕННЫЕ ==========
let bot = null;
let startTime = Date.now();
let totalDistance = 0;
let lastPos = null;
let moving = false;
let pathIndex = 0;
let mcData = null;
let reconnectAttempts = 0;
let walkingTimer = null;
let isConnecting = false;

// Точки для ходьбы (безопасные, в пределах спавна)
const waypoints = [
    {x: 0, z: 0},
    {x: 3, z: 0},
    {x: 3, z: 3},
    {x: 0, z: 3},
    {x: -3, z: 3},
    {x: -3, z: 0},
    {x: -3, z: -3},
    {x: 0, z: -3},
    {x: 3, z: -3}
];

// ========== ФУНКЦИИ ==========
function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}ч ${minutes}м ${secs}с`;
}

function loadLogs() {
    try {
        if (fs.existsSync(CONFIG.logFile)) {
            const data = JSON.parse(fs.readFileSync(CONFIG.logFile));
            totalDistance = data.totalDistance || 0;
            startTime = data.startTime || Date.now();
            console.log(`📂 Загружено: пройдено ${totalDistance.toFixed(1)} м`);
        }
    } catch(e) {}
}

function saveLogs() {
    try {
        fs.writeFileSync(CONFIG.logFile, JSON.stringify({
            totalDistance: totalDistance,
            startTime: startTime,
            lastUpdate: Date.now()
        }, null, 2));
    } catch(e) {}
}

// ========== БЕЗОПАСНАЯ ОТПРАВКА СООБЩЕНИЯ ==========
function safeChat(msg) {
    if (!bot || !bot._client) return;
    try {
        // Убираем все спецсимволы, оставляем только буквы, цифры, пробелы и базовые знаки
        const cleanMsg = msg.replace(/[^a-zA-Zа-яА-Я0-9\s\.\,\!\?\-\/]/g, '');
        if (cleanMsg.length > 0 && cleanMsg.length < 256) {
            bot.chat(cleanMsg);
            console.log(`💬 Отправлено: ${cleanMsg.substring(0, 50)}`);
        }
    } catch(e) {
        console.log('⚠️ Не удалось отправить сообщение');
    }
}

// ========== ПОКАЗ СТАТИСТИКИ (БЕЗ ОПЧАТА) ==========
function showStats() {
    const elapsed = Date.now() - startTime;
    const timeStr = formatTime(elapsed);
    const msg = `Bot stats: Online ${timeStr}, walked ${totalDistance.toFixed(1)}m`;
    console.log(`📊 ${msg}`);
    // Не шлём в чат, чтобы не кикало
}

// ========== ДВИЖЕНИЕ БОТА ==========
function startWalking() {
    if (!bot || !bot.pathfinder || moving || !mcData) {
        return;
    }
    
    moving = true;
    const waypoint = waypoints[pathIndex % waypoints.length];
    const currentY = Math.floor(bot.entity.position.y);
    const targetY = Math.max(currentY - 1, 60);
    
    const target = vec3(waypoint.x, targetY, waypoint.z);
    
    try {
        const movements = new Movements(bot, mcData);
        movements.allowParkour = false;
        movements.allowSprinting = false;
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
        bot.pathfinder.setGoal(new goalBlocks(target.x, target.y, target.z));
        
        // Ждём прибытия
        const checkInterval = setInterval(() => {
            if (!bot || !bot.entity) {
                clearInterval(checkInterval);
                return;
            }
            
            const dist = Math.sqrt(
                Math.pow(bot.entity.position.x - target.x, 2) +
                Math.pow(bot.entity.position.z - target.z, 2)
            );
            
            if (dist < 1.5) {
                clearInterval(checkInterval);
                moving = false;
                pathIndex++;
                
                // Обновляем расстояние
                if (lastPos) {
                    const dx = bot.entity.position.x - lastPos.x;
                    const dz = bot.entity.position.z - lastPos.z;
                    const moved = Math.sqrt(dx*dx + dz*dz);
                    if (moved > 0.3 && moved < 10) {
                        totalDistance += moved;
                        saveLogs();
                        console.log(`🚶 +${moved.toFixed(1)} м, всего: ${totalDistance.toFixed(1)} м`);
                    }
                }
                lastPos = {x: bot.entity.position.x, z: bot.entity.position.z};
                
                // Показываем статистику раз в 20 шагов
                if (pathIndex % 20 === 0) {
                    showStats();
                }
            }
        }, 1000);
        
        // Таймаут на случай застревания
        setTimeout(() => {
            clearInterval(checkInterval);
            if (moving) {
                moving = false;
                if (bot && bot.pathfinder) {
                    bot.pathfinder.setGoal(null);
                }
            }
        }, 15000);
        
    } catch(e) {
        console.log('⚠️ Ошибка движения:', e.message);
        moving = false;
    }
}

// ========== ПОДКЛЮЧЕНИЕ К СЕРВЕРУ ==========
function connect() {
    if (isConnecting) return;
    isConnecting = true;
    
    console.log(`🔌 Подключение к ${CONFIG.host}:${CONFIG.port}...`);
    
    const options = {
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.username,
        version: CONFIG.version,
        viewDistance: 'tiny',
        skipValidation: true
    };
    
    if (CONFIG.password) options.password = CONFIG.password;
    
    bot = mineflayer.createBot(options);
    
    bot.loadPlugin(pathfinder);
    
    bot.once('spawn', () => {
        console.log('📍 Бот появился в мире');
        isConnecting = false;
        
        if (!mcData) {
            mcData = require('minecraft-data')(bot.version);
        }
        
        lastPos = {x: bot.entity.position.x, z: bot.entity.position.z};
        
        // Задержка перед первым движением
        setTimeout(() => {
            if (bot && bot.pathfinder && !moving) {
                startWalking();
            }
        }, 5000);
    });
    
    bot.on('login', () => {
        console.log(`✅ Бот ${CONFIG.username} зашёл на сервер!`);
        reconnectAttempts = 0;
        loadLogs();
        
        // Очищаем старый таймер
        if (walkingTimer) clearInterval(walkingTimer);
        
        // Запускаем периодическое движение
        walkingTimer = setInterval(() => {
            if (bot && bot.pathfinder && !moving && bot.entity) {
                startWalking();
            }
        }, CONFIG.moveInterval);
        
        // Периодический лог в консоль (не в чат!)
        setInterval(() => {
            if (bot && bot.entity) {
                showStats();
            }
        }, 300000); // каждые 5 минут
    });
    
    bot.on('error', (err) => {
        console.error('❌ Ошибка:', err.message);
        isConnecting = false;
    });
    
    bot.on('end', (reason) => {
        console.log(`🔴 Отключён: ${reason || 'неизвестно'}`);
        isConnecting = false;
        if (walkingTimer) clearInterval(walkingTimer);
        moving = false;
        
        reconnectAttempts++;
        const delay = Math.min(30000, reconnectAttempts * 3000);
        console.log(`🔄 Переподключение через ${delay/1000} сек...`);
        
        setTimeout(() => {
            if (!isConnecting) connect();
        }, delay);
    });
    
    bot.on('kicked', (reason) => {
        let reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
        console.log(`👢 Кикнут: ${reasonText.substring(0, 100)}`);
        isConnecting = false;
        if (walkingTimer) clearInterval(walkingTimer);
        moving = false;
        
        // При кике ждём дольше
        const delay = 15000;
        console.log(`🔄 Переподключение через ${delay/1000} сек...`);
        setTimeout(() => {
            if (!isConnecting) connect();
        }, delay);
    });
}

// ========== ЗАПУСК ==========
loadLogs();
connect();

process.on('SIGINT', () => {
    saveLogs();
    console.log('👋 Бот остановлен');
    process.exit();
});

process.on('uncaughtException', (err) => {
    console.error('💥 Ошибка:', err.message);
    saveLogs();
    isConnecting = false;
    moving = false;
    setTimeout(() => {
        if (!isConnecting) connect();
    }, 10000);
});
