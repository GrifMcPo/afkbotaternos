// ============================================
// 🤖 ATERNOS БОТ — AFK PROTECTION
// Работает через GitHub Actions 24/7
// ============================================

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const vec3 = require('vec3');
const fs = require('fs');

const goalBlocks = goals.GoalBlock;

// ========== НАСТРОЙКИ (МЕНЯЙ ЗДЕСЬ) ==========
const CONFIG = {
    host: 'botcreatortest.aternos.me',  // Твой IP / домен Aternos
    port: 23209,                         // Порт
    username: 'GrifBot',                 // Ник бота
    password: '',                        // Пароль (если есть)
    version: '1.20.4',                   // Версия Minecraft
    opChat: true,                        // Писать в /opchat?
    checkInterval: 60000,                // Проверка каждые 60 секунд
    moveInterval: 30000,                 // Двигать бота каждые 30 секунд
    logFile: 'bot_log.json'              // Файл с логами
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
let mcData = null;

// Ленивые точки для ходьбы
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
    } catch(e) {
        console.log('📂 Новые логи');
    }
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
function sendStats() {
    if (!bot || !bot.player) return;
    
    const elapsed = Date.now() - startTime;
    const timeStr = formatTime(elapsed);
    
    const statsMsg = `§e[GrifBot] §7Статистика: §fВремя §a${timeStr} §7| Пройдено §a${totalDistance.toFixed(1)}§7 м`;
    
    if (CONFIG.opChat) {
        bot.chat(`/opchat ${statsMsg}`);
    } else {
        bot.chat(statsMsg);
    }
    
    console.log(`📊 ${statsMsg}`);
}

// ========== ДВИЖЕНИЕ БОТА ==========
function startWalking() {
    if (!bot || !bot.pathfinder || moving) return;
    if (!mcData) return;
    
    moving = true;
    const waypoint = waypoints[pathIndex % waypoints.length];
    
    // Ищем ближайший безопасный блок
    const y = Math.floor(bot.entity.position.y);
    const targetY = Math.max(y - 2, 60);
    
    const target = vec3(waypoint.x, targetY, waypoint.z);
    
    // Настраиваем движения
    const movements = new Movements(bot, mcData);
    movements.allowParkour = true;
    movements.allowSprinting = true;
    bot.pathfinder.setMovements(movements);
    
    bot.pathfinder.setGoal(new goalBlocks(target.x, target.y, target.z));
    
    const goalCheck = setInterval(() => {
        if (!bot || !bot.pathfinder) {
            clearInterval(goalCheck);
            return;
        }
        const goal = bot.pathfinder.goal;
        if (goal && goal.x === target.x && goal.z === target.z) {
            clearInterval(goalCheck);
            setTimeout(() => {
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
                        console.log(`🚶 +${moved.toFixed(1)} м, всего: ${totalDistance.toFixed(1)} м`);
                    }
                }
                lastPos = {x: bot.entity.position.x, z: bot.entity.position.z};
                
                // Периодически показываем статистику
                if (pathIndex % 10 === 0) {
                    sendStats();
                }
                
                // Задержка перед следующим движением
                setTimeout(() => {
                    if (bot && bot.pathfinder && !moving) {
                        startWalking();
                    }
                }, 2000);
            }, 1000);
        }
    }, 500);
    
    // Таймаут на случай ошибки
    setTimeout(() => {
        clearInterval(goalCheck);
        if (moving) {
            moving = false;
            if (bot && bot.pathfinder) {
                bot.pathfinder.setGoal(null);
            }
            setTimeout(() => {
                if (bot && bot.pathfinder && !moving) startWalking();
            }, 3000);
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
    
    // Подключаем pathfinder
    bot.loadPlugin(pathfinder);
    
    bot.once('spawn', () => {
        console.log('📍 Бот появился в мире');
        
        // Получаем данные о блоках
        mcData = require('minecraft-data')(bot.version);
        
        lastPos = {x: bot.entity.position.x, z: bot.entity.position.z};
        
        // Запускаем движение после небольшой задержки
        setTimeout(() => {
            if (bot && bot.pathfinder) {
                startWalking();
            }
        }, 3000);
    });
    
    bot.on('login', () => {
        console.log(`✅ Бот ${CONFIG.username} зашёл на сервер!`);
        reconnectAttempts = 0;
        loadLogs();
        
        // Очищаем старый таймер
        if (walkingTimer) clearInterval(walkingTimer);
        
        // Периодически проверяем, нужно ли двигаться
        walkingTimer = setInterval(() => {
            if (bot && bot.pathfinder && !moving) {
                startWalking();
            }
        }, CONFIG.moveInterval);
        
        // Периодическая проверка статуса
        setInterval(() => {
            if (bot && bot.player) {
                console.log(`❤️ Здоровье: ${bot.player.health}, Еда: ${bot.player.food}`);
            }
        }, CONFIG.checkInterval);
        
        // Отправляем приветствие
        setTimeout(() => {
            const elapsed = Date.now() - startTime;
            const welcomeMsg = `§a[GrifBot] §7Бот запущен! Время: §a${formatTime(elapsed)}§7, пройдено: §a${totalDistance.toFixed(1)}§7 м`;
            if (CONFIG.opChat) {
                bot.chat(`/opchat ${welcomeMsg}`);
            } else {
                bot.chat(welcomeMsg);
            }
        }, 5000);
    });
    
    bot.on('chat', (username, message) => {
        if (username === CONFIG.username) return;
        
        const lowerMsg = message.toLowerCase();
        
        // Ответ на запрос статистики
        if ((lowerMsg.includes('бот') || lowerMsg.includes('grifbot')) && 
            (lowerMsg.includes('стат') || lowerMsg.includes('stat') || lowerMsg.includes('сколько'))) {
            const elapsed = Date.now() - startTime;
            const response = `§e[GrifBot] §7В игре §a${formatTime(elapsed)}§7, пройдено §a${totalDistance.toFixed(1)}§7 м`;
            setTimeout(() => {
                if (CONFIG.opChat) {
                    bot.chat(`/opchat ${response}`);
                } else {
                    bot.chat(response);
                }
            }, 1000);
        }
        
        // Приветствие
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
        console.error('❌ Ошибка:', err.message);
    });
    
    bot.on('end', (reason) => {
        console.log(`🔴 Отключён: ${reason || 'неизвестная причина'}`);
        if (walkingTimer) clearInterval(walkingTimer);
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
        if (walkingTimer) clearInterval(walkingTimer);
        moving = false;
        setTimeout(() => connect(), 10000);
    });
}

// ========== ОБНОВЛЕННЫЙ package.json ==========
// ========== ЗАПУСК ==========
loadLogs();
connect();

// Сохраняем логи при выходе
process.on('SIGINT', () => {
    saveLogs();
    console.log('👋 Бот остановлен, логи сохранены');
    process.exit();
});

process.on('uncaughtException', (err) => {
    console.error('💥 Непойманная ошибка:', err.message);
    saveLogs();
    setTimeout(() => connect(), 10000);
});
