"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const csv_writer_1 = require("csv-writer");
const dayjs_1 = __importDefault(require("dayjs"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const channelId = process.env.SLACK_CHANNEL_ID;
const token = process.env.SLACK_TOKEN;
const myUserId = process.env.MY_USER_ID;
// Main execution logic
main(channelId, token)
    .then(async (messages) => {
    console.log(`🚀 ~ Found ${messages.length} messages in channel`);
    const organizedMessages = organizeMessagesByDate(messages, myUserId);
    await writeDataToCSV(organizedMessages);
    await fetchChatGPTSummary(organizedMessages)
        .then(summary => {
        if (summary) {
            fs_1.default.writeFile('generated/monthly-summary.txt', summary, err => {
                if (err) {
                    console.error('Failed to write summary to file:', err.message);
                }
                else {
                    console.log('Monthly summary saved successfully.');
                }
            });
        }
    }).catch(err => {
        console.error('Failed fetch ChatGPT summary ~ ', err.message);
    });
})
    .catch(error => {
    console.error("Error while fetching remote messages ~ ", error.message);
});
async function main(channelId, token, startDate, endDate) {
    console.log(`🚀 ~ Start fetching messages from slack channel #${channelId}`);
    let messages = [];
    let cursor;
    const format = "YYYY-MM-DD";
    if (!startDate || !(0, dayjs_1.default)(startDate, format).isValid()) {
        startDate = (0, dayjs_1.default)().startOf('month').format(format);
    }
    if (!endDate || !(0, dayjs_1.default)(endDate, format).isValid()) {
        endDate = (0, dayjs_1.default)().endOf('month').format(format);
    }
    const oldest = (0, dayjs_1.default)(startDate).unix(); // Convert to UNIX timestamp
    const latest = (0, dayjs_1.default)(endDate).unix(); // Convert to UNIX timestamp
    do {
        const params = new URLSearchParams({
            channel: channelId,
            oldest: oldest.toString(),
            latest: latest.toString(),
            inclusive: 'true'
        });
        if (cursor) {
            params.append("cursor", cursor);
        }
        const response = await axios_1.default.get(`https://slack.com/api/conversations.history?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.data.ok) {
            throw new Error(response.data.error || "Failed to fetch messages");
        }
        messages = messages.concat(response.data.messages);
        cursor = response.data.response_metadata ? response.data.response_metadata.next_cursor : undefined;
    } while (cursor);
    return messages;
}
function organizeMessagesByDate(messages, myUserId) {
    const messagesByDate = {};
    messages.forEach(message => {
        const date = new Date(parseFloat(message.ts) * 1000).toISOString().split("T")[0];
        if (!messagesByDate[date]) {
            messagesByDate[date] = [];
        }
        let text = message.text;
        if (message.user === myUserId) {
            text = `${process.env.MY_MESSAGE_PREFIX}: ${text}`; // Prefix personal messages
        }
        messagesByDate[date].push(text);
    });
    return messagesByDate;
}
async function writeDataToCSV(messagesByDate) {
    const csvWriter = (0, csv_writer_1.createObjectCsvWriter)({
        path: "generated/slack-messages.csv",
        header: [
            { id: "date", title: "DATE" },
            { id: "message", title: "MESSAGE" }
        ]
    });
    const records = Object.entries(messagesByDate).flatMap(([date, messages]) => messages.map(message => ({ date, message })));
    await csvWriter.writeRecords(records);
    console.log("🚀 ~  The CSV file was written successfully into #generated/slack-messages.csv");
}
/**
 * ! Still failing
 * @param messagesByDate organized messages
 * @returns summary
 */
async function fetchChatGPTSummary(messagesByDate) {
    const apiKey = process.env.OPENAI_API_KEY;
    const endpoint = "https://api.openai.com/v1/chat/completions";
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };
    const data = {
        prompt: generatePrompt(messagesByDate),
        max_tokens: 1024
    };
    const response = await axios_1.default.post(endpoint, data, { headers });
    return response.data.choices[0].text;
}
function generatePrompt(messagesByDate) {
    const prompt = Object.entries(messagesByDate).reduce((acc, [date, messages]) => {
        const myMessages = messages.filter(msg => msg.startsWith("my-msg:")).map(msg => msg.slice(8));
        if (myMessages.length > 0) {
            acc += `**${date}**:\n- ${myMessages.join('\n- ')}\n`;
        }
        return acc;
    }, "Generate a monthly summary based on these daily activities:\n");
    return prompt;
}
