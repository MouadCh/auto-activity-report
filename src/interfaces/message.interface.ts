export interface Message {
    ts: string;
    text: string;
    user: string;
    thread_ts?: string;
}

export interface MessagesByDate {
    [key: string]: string[];
}