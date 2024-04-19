import axios from 'axios';
import fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
import { Message, MessagesByDate } from './interfaces/message.interface';
dotenv.config();


const channelId: string = process.env.SLACK_CHANNEL_ID!;
const token: string = process.env.SLACK_TOKEN!;
const myUserId: string = process.env.MY_USER_ID!;

// Main execution logic
main(channelId, token)
  .then(async messages => {
    console.log(`🚀 ~ Found ${messages.length} messages in channel`);

    const organizedMessages = organizeMessagesByDate(messages, myUserId);
    await writeDataToCSV(organizedMessages);
    await fetchChatGPTSummary(organizedMessages)
        .then(summary => {
            if (summary) {
                fs.writeFile('generated/monthly-summary.txt', summary, err => {
                    if (err) {
                        console.error('Failed to write summary to file:', err.message);
                    } else {
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

async function main(channelId: string, token: string, startDate?: string, endDate?: string): Promise<Message[]> {
    console.log(`🚀 ~ Start fetching messages from slack channel #${channelId}`);
    
    let messages: Message[] = [];
    let cursor: string | undefined;

    const format = "YYYY-MM-DD";
    if (!startDate || !dayjs(startDate, format).isValid()) {
      startDate = dayjs().startOf('month').format(format);
    }
    if (!endDate || !dayjs(endDate, format).isValid()) {
      endDate = dayjs().endOf('month').format(format);
    }

    const oldest = dayjs(startDate).unix(); // Convert to UNIX timestamp
    const latest = dayjs(endDate).unix();   // Convert to UNIX timestamp

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

      const response = await axios.get(`https://slack.com/api/conversations.history?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.data.ok) {
        throw new Error(response.data.error || "Failed to fetch messages");
      }

      messages = messages.concat(response.data.messages as Message[]);

      cursor = response.data.response_metadata ? response.data.response_metadata.next_cursor : undefined;
    } while (cursor);

    return messages;
}

function organizeMessagesByDate(messages: Message[], myUserId: string): MessagesByDate {
    const messagesByDate: MessagesByDate = {};
    messages.forEach(message => {
        const date = new Date(parseFloat(message.ts) * 1000).toISOString().split("T")[0];
        if (!messagesByDate[date]) {
            messagesByDate[date] = [];
        }
        let text = message.text;
        if (message.user === myUserId) {
            text = `${process.env.MY_MESSAGE_PREFIX}: ${text}`;  // Prefix personal messages
        }
        messagesByDate[date].push(text);
    });
    return messagesByDate;
}

async function writeDataToCSV(messagesByDate: MessagesByDate): Promise<void> {
    const csvWriter = createObjectCsvWriter({
        path: "generated/slack-messages.csv",
        header: [
            { id: "date", title: "DATE" },
            { id: "message", title: "MESSAGE" }
        ]
    });

    const records = Object.entries(messagesByDate).flatMap(([date, messages]) => 
        messages.map(message => ({ date, message }))
    );

    await csvWriter.writeRecords(records);
    console.log("🚀 ~  The CSV file was written successfully into #generated/slack-messages.csv");
}

async function fetchChatGPTSummary(messagesByDate: MessagesByDate): Promise<string | null> {
    const apiKey = process.env.OPENAI_API_KEY!;
    const endpoint = "https://api.openai.com/v1/engines/text-davinci-002/completions";

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const data = {
        prompt: generatePrompt(messagesByDate),
        max_tokens: 1024
    };

    const response = await axios.post(endpoint, data, { headers });
    return response.data.choices[0].text;
}

function generatePrompt(messagesByDate: MessagesByDate): string {
    const prompt = Object.entries(messagesByDate).reduce((acc, [date, messages]) => {
        const myMessages = messages.filter(msg => msg.startsWith("my-msg:")).map(msg => msg.slice(8));
        if (myMessages.length > 0) {
            acc += `**${date}**:\n- ${myMessages.join('\n- ')}\n`;
        }
        return acc;
    }, "Generate a monthly summary based on these daily activities:\n");

    return prompt;
}
