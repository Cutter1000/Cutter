const express = require('express');
const { google } = require('googleapis');

// Инициализируем приложение
const app = express();
app.use(express.json());

// === КОНФИГУРАЦИЯ ===
// ID вашей Google таблицы (из ссылки)
const SPREADSHEET_ID = '1bj86NKgmTEP9S7s5ifXE-JEIbUMOuJJ8WayJ857tuzQ';

// === ФУНКЦИИ ДЛЯ РАБОТЫ С GOOGLE SHEETS ===

// Авторизация в Google API
async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: __dirname + '/credentials.json', // Путь к вашему ключу
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth;
}

// Получить ВСЕ email из таблицы (для проверки дублей)
async function getAllEmailsFromSheet() {
    try {
        const auth = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'A2:A', // Читаем колонку A, начиная со 2-й строки
        });
        
        // Преобразуем данные в Set для быстрого поиска
        const emails = response.data.values 
            ? response.data.values.flat().filter(email => email && email.includes('@')) 
            : [];
        
        console.log(`📊 В таблице найдено ${emails.length} email`);
        return new Set(emails.map(email => email.toLowerCase().trim()));
    } catch (error) {
        console.error('❌ Ошибка при чтении таблицы:', error.message);
        return new Set();
    }
}

// Добавить email в таблицу
async function addEmailToSheet(email) {
    try {
        const auth = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        const date = new Date().toLocaleDateString('ru-RU'); // Формат ДД.ММ.ГГГГ
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'A:B',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[email, date]]
            }
        });
        
        console.log(`✅ Добавлен: ${email} (${date})`);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка при добавлении ${email}:`, error.message);
        return false;
    }
}

// === ОСНОВНОЙ ОБРАБОТЧИК ВЕБХУКА ===
app.post('/webhook/amocrm', async (req, res) => {
    console.log('📨 Вебхук получен:', new Date().toISOString());
    
    // Отвечаем AMoCRM сразу (обязательно в течение 15 сек)
    res.status(200).json({ status: 'ok', message: 'Данные приняты в обработку' });
    
    // Обрабатываем данные асинхронно
    try {
        const contacts = req.body.contacts || [];
        const existingEmails = await getAllEmailsFromSheet();
        let addedCount = 0;
        
        console.log(`Найдено контактов для обработки: ${contacts.length}`);
        
        // Перебираем все контакты из вебхука
        for (const contact of contacts) {
            // Ищем поле с email в кастомных полях контакта
            if (contact.custom_fields) {
                const emailFields = contact.custom_fields.filter(
                    field => field.code === 'EMAIL' || 
                            field.name?.toLowerCase().includes('email')
                );
                
                // Перебираем все найденные email-поля
                for (const emailField of emailFields) {
                    if (emailField.values && emailField.values.length > 0) {
                        for (const value of emailField.values) {
                            const email = value.value?.trim();
                            
                            // Проверяем, что это похоже на email
                            if (email && email.includes('@')) {
                                const normalizedEmail = email.toLowerCase();
                                
                                // Проверяем, есть ли уже такой email в таблице
                                if (!existingEmails.has(normalizedEmail)) {
                                    // Добавляем новый email
                                    const success = await addEmailToSheet(email);
                                    if (success) {
                                        existingEmails.add(normalizedEmail); // Обновляем кэш
                                        addedCount++;
                                    }
                                } else {
                                    console.log(`↪️ Пропущен (уже есть): ${email}`);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`✅ Итог: добавлено ${addedCount} новых email`);
        
    } catch (error) {
        console.error('🔥 Критическая ошибка обработки:', error);
    }
});

// === ТЕСТОВЫЕ МАРШРУТЫ (для проверки) ===

// 1. Проверка работы сервера
app.get('/test', async (req, res) => {
    try {
        const emails = await getAllEmailsFromSheet();
        res.json({ 
            status: 'ok',
            message: 'Сервер работает!',
            spreadsheet_id: SPREADSHEET_ID,
            total_emails: emails.size
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error',
            error: error.message 
        });
    }
});

// 2. Ручное добавление email (для тестирования)
app.post('/add-test-email', async (req, res) => {
    const { email } = req.body;
    
    if (!email || !email.includes('@')) {
        return res.status(400).json({ 
            status: 'error',
            message: 'Некорректный email' 
        });
    }
    
    try {
        const existingEmails = await getAllEmailsFromSheet();
        const normalizedEmail = email.toLowerCase().trim();
        
        if (existingEmails.has(normalizedEmail)) {
            return res.json({ 
                status: 'info',
                message: 'Email уже существует в таблице' 
            });
        }
        
        const success = await addEmailToSheet(email);
        
        if (success) {
            res.json({ 
                status: 'success',
                message: 'Email успешно добавлен' 
            });
        } else {
            res.status(500).json({ 
                status: 'error',
                message: 'Не удалось добавить email' 
            });
        }
        
    } catch (error) {
        res.status(500).json({ 
            status: 'error',
            error: error.message 
        });
    }
});

// 3. Простейший маршрут для проверки
app.get('/', (req, res) => {
    res.send(`
        <h1>AMoCRM → Google Sheets Sync</h1>
        <p>Сервер работает!</p>
        <p>Для проверки перейдите по ссылкам:</p>
        <ul>
            <li><a href="/test">/test</a> - Проверка соединения с таблицей</li>
            <li>Используйте POST запрос на <code>/add-test-email</code> для ручного добавления email</li>
            <li>Вебхук AMoCRM: <code>/webhook/amocrm</code></li>
        </ul>
    `);
});

// === ЗАПУСК СЕРВЕРА ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
🚀 Сервер запущен!
📍 Порт: ${PORT}
📊 Таблица: ${SPREADSHEET_ID}
🔗 Тестовая страница: http://localhost:${PORT}
🔗 Проверка работы: http://localhost:${PORT}/test
    `);
});