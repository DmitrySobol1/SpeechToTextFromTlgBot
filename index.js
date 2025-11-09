import express from "express";
import axios from "axios";
import { OpenAI } from "openai";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";

const app = express();
const PORT = 4444;

app.use(express.json());

/**
 * Функция: конвертировать аудио файл в MP3
 */
function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat("mp3")
      .on("end", () => {
        console.log("✅ Конвертация завершена");
        resolve(outputPath);
      })
      .on("error", (err) => {
        console.error("❌ Ошибка конвертации:", err);
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * Функция: скачать voice-файл из Telegram и транскрибировать его в текст
 */
async function transcribeTelegramVoice(fileId, telegramToken, openaiApiKey,model) {
  const openai = new OpenAI({ apiKey: openaiApiKey });
  
  try {
    // 1. Получаем путь к файлу через getFile
    const fileInfoRes = await axios.get(
      `https://api.telegram.org/bot${telegramToken}/getFile?file_id=${fileId}`
    );
    const fileInfo = fileInfoRes.data;

    // Проверка ответа от Telegram API
    if (!fileInfo.ok) {
      throw new Error(`Telegram API error: ${fileInfo.description || 'Unknown error'}`);
    }

    const filePath = fileInfo.result.file_path;

    // 2. Формируем URL для скачивания файла
    const fileUrl = `https://api.telegram.org/file/bot${telegramToken}/${filePath}`;

    // 3. Скачиваем файл
    const audioRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const buffer = audioRes.data;

    // Сохраняем оригинальный файл
    const originalFileName = path.basename(filePath);
    fs.writeFileSync(originalFileName, Buffer.from(buffer));
    console.log(`📥 Файл скачан: ${originalFileName}`);

    // 4. Конвертируем в MP3
    const mp3FileName = originalFileName.replace(/\.[^/.]+$/, "") + ".mp3";
    await convertToMp3(originalFileName, mp3FileName);

    // 5. Отправляем в OpenAI
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(mp3FileName),
      model: model,
    });

    // Удаляем временные файлы
    fs.unlinkSync(originalFileName);
    fs.unlinkSync(mp3FileName);
    console.log("🗑️ Временные файлы удалены");

    console.log("✅ Расшифровка:", transcription.text);
    return transcription.text;
  } catch (error) {
    console.error("Ошибка при транскрибации:", error);
  }
}

// API endpoint для транскрибации
app.post("/transcribe", async (req, res) => {
  try {
    const { fileId, telegram_token, openai_api_key, model } = req.body;

    // Валидация входных данных
    if (!fileId || !telegram_token || !openai_api_key || !model ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    console.log(`📝 Получен запрос на транскрибацию fileId: ${fileId}`);

    // Выполняем транскрибацию
    const transcription = await transcribeTelegramVoice(
      fileId,
      telegram_token,
      openai_api_key,
      model
    );

    // Возвращаем результат
    res.json({
      success: true,
      transcription: transcription
    });

  } catch (error) {
    console.error("❌ Ошибка при обработке запроса:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});



// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
