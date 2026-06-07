// ============================================
// 🤖 ATERNOS БОТ — НЕЗАМЕТНЫЙ АФК
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
let reconnectTimer = null;
let isConnecting = false;
let pingInterval = null;

// Только 3 точки, чтобы не спамить движением
const waypoints = [
    {x: 0, z: 0},
    {x: 2, z: 0},
    {x: 0, z: 2},
    {x: -2, z: 0},
    {x: 0, z: -2}
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
            console.log(`📂 Загружено: ${totalDistance.toFixed(1)} м`);
        }
    } catch(e) {}
}

function saveLogs() {
    try {
        fs.writeFileSync(CONFIG.logFile, JSON.stringify({
            totalDistance: totalDistance,
            startTime: startTime
        }, null, 2));
    } catch(e) {}
}

// ========== НИЧЕГО НЕ ПИШЕМ В ЧАТ ==========
// (полностью отключаем отправку сообщений)

// ========== ОЧЕНЬ МЕДЛЕННОЕ ДВИЖЕНИЕ ==========
function startWalking() {
    if (!bot || !bot.pathfinder || moving || !mcData) return;
    if (!bot.entity) return;
    
    moving = true;
    const waypoint = waypoints[pathIndex % waypoints.length];
    
    // Находим землю под ногами
    let groundY = Math.floor(bot.entity.position.y) - 1;
    if (groundY < 60) groundY = 64;
    
    const target = vec3(waypoint.x, groundY, waypoint.z);
    
    try {
        const movements = new Movements(bot, mcData);
        movements.allowParkour = false;
        movements.allowSprinting = false;
        movements.canDig = false;
        movements.maxDropDown = 1;
        bot.pathfinder.setMovements(movements);
        bot.pathfinder.setGoal(new goalBlocks(target.x, target.y, target.z));
        
        let checkCount = 0;
        const checkInterval = setInterval(() => {
            if (!bot || !bot.entity) {
                clearInterval(checkInterval);
                moving = false;
                return;
            }
            
            checkCount++;
            const dist = Math.sqrt(
                Math.pow(bot.entity.position.x - target.x, 2) +
                Math.pow(bot.entity.position.z - target.z, 2)
            );
            
            if (dist < 1.0 || checkCount > 30) {
                clearInterval(checkInterval);
                moving = false;
                
                if (dist < 1.0) {
                    pathIndex++;
                    // Обновляем расстояние
                    if (lastPos) {
                        const dx = bot.entity.position.x - lastPos.x;
                        const dz = bot.entity.position.z - lastPos.z;
                        const moved = Math.sqrt(dx*dx + dz*dz);
                        if (moved > 0.2 && moved < 5) {
                            totalDistance += moved;
                            saveLogs();
                            console.log(`🚶 +${moved.toFixed(1)} м, всего: ${totalDistance.toFixed(1)} м`);
                        }
                    }
                    lastPos = {x: bot.entity.position.x, z: bot.entity.position.z};
                }
                
                // Следующее движение через 30-60 секунд
                setTimeout(() => {
                    if (bot && bot.pathfinder && !moving && bot.entity) {
                        startWalking();
                    }
                }, 30000 + Math.random() * 30000);
            }
        }, 1000);
        
    } catch(e) {
        console.log('⚠️ Ошибка движения');
        moving = false;
        setTimeout(() => {
            if (bot && bot.pathfinder && !moving && bot.entity) {
                startWalking();
            }
        }, 60000);
    }
}

// ========== ПОДДЕРЖАНИЕ СОЕДИНЕНИЯ ==========
function keepAlive() {
    if (!bot || !bot._client) return;
    // Просто отправляем пинг, чтобы сервер думал, что игрок активен
    try {
        bot._client.write('keep_alive', { keepAliveId: Math.floor(Math.random() * 100000) });
    } catch(e) {}
}

// ========== ПОДКЛЮЧЕНИЕ ==========
function connect() {
    if (isConnecting) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    isConnecting = true;
    
    console.log(`🔌 Подключение к ${CONFIG.host}:${CONFIG.port}...`);
    
    const options = {
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.username,
        version: CONFIG.version,
        viewDistance: 'tiny',
        skipValidation: true,
        auth: 'offline'
    };
    
    if (CONFIG.password) options.password = CONFIG.password;
    
    bot = mineflayer.createBot(options);
    bot.loadPlugin(pathfinder);
    
    bot.on('login', () => {
        console.log(`✅ Бот ${CONFIG.username} зашёл!`);
        isConnecting = false;
        reconnectTimer = null;
        loadLogs();
        
        // Пинг каждые 10 секунд
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => keepAlive(), 10000);
    });
    
    bot.once('spawn', () => {
        console.log('📍 Бот в мире');
        
        if (!mcData) {
            try {
                mcData = require('minecraft-data')(bot.version);
            } catch(e) {
                console.log('⚠️ Нет данных для версии', bot.version);
            }
        }
        
        lastPos = {x: bot.entity.position.x, z: bot.entity.position.z};
        
        // Первое движение через 20 секунд
        setTimeout(() => {
            if (bot && bot.pathfinder && !moving && bot.entity && mcData) {
                startWalking();
            }
        }, 20000);
    });
    
    bot.on('error', (err) => {
        if (err.code === 'ECONNRESET') {
            console.log('⚠️ Сброс соединения (нормально)');
        } else {
            console.log('❌ Ошибка:', err.code || err.message);
        }
    });
    
    bot.on('end', (reason) => {
        console.log(`🔴 Отключён`);
        isConnecting = false;
        if (pingInterval) clearInterval(pingInterval);
        moving = false;
        
        // Переподключение через 30-60 секунд
        const delay = 30000 + Math.random() * 30000;
        console.log(`🔄 Переподключение через ${Math.round(delay/1000)} сек...`);
        reconnectTimer = setTimeout(() => {
            if (!isConnecting) connect();
        }, delay);
    });
    
    bot.on('kicked', (reason) => {
        console.log(`👢 Кикнут`);
        isConnecting = false;
        if (pingInterval) clearInterval(pingInterval);
        moving = false;
        
        // При кике ждём минуту
        const delay = 60000;
        console.log(`🔄 Переподключение через ${delay/1000} сек...`);
        reconnectTimer = setTimeout(() => {
            if (!isConnecting) connect();
        }, delay);
    });
}

// ========== ЗАПУСК ==========
loadLogs();
connect();

process.on('SIGINT', () => {
    saveLogs();
    if (pingInterval) clearInterval(pingInterval);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (bot) bot.end();
    console.log('👋 Бот остановлен');
    setTimeout(() => process.exit(), 1000);
});

process.on('uncaughtException', (err) => {
    console.log('💥 Ошибка:', err.message);
    isConnecting = false;
    moving = false;
});
