import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom, from, Observable } from 'rxjs';

export interface DocumentUpload {
  file_name: string;
  characters: number;
  chunks: number;
}

export interface AnswerResult {
  answer: string;
}

interface IndexedChunk {
  text: string;
  embedding: number[];
}

interface IndexedDocument {
  chunks: IndexedChunk[];
}

interface EmbeddingResponse {
  embeddings: number[][];
}

interface ChatResponse {
  message: { content: string };
}

const MAX_QUESTION_LENGTH = 1000;
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const EMBEDDING_BATCH_SIZE = 64;
const RETRIEVAL_COUNT = 4;

@Injectable({ providedIn: 'root' })
export class RagApiService {
  private readonly apiUrl = 'http://localhost:11434/api';
  private indexedDocument: IndexedDocument | null = null;

  constructor(private readonly http: HttpClient) {}

  uploadDocument(file: File): Observable<DocumentUpload> {
    return from(this.indexDocument(file));
  }

  askQuestion(question: string): Observable<AnswerResult> {
    return from(this.generateAnswer(question));
  }

  private async indexDocument(file: File): Promise<DocumentUpload> {
    const text = await this.readDocument(file);
    const chunkTexts = this.splitIntoChunks(text);
    const chunks: IndexedChunk[] = [];

    for (let start = 0; start < chunkTexts.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = chunkTexts.slice(start, start + EMBEDDING_BATCH_SIZE);
      const response = await firstValueFrom(
        this.http.post<EmbeddingResponse>(`${this.apiUrl}/embed`, {
          model: 'nomic-embed-text',
          input: batch,
        }),
      );

      if (
        !Array.isArray(response.embeddings) ||
        response.embeddings.length !== batch.length ||
        response.embeddings.some(
          (embedding) =>
            !Array.isArray(embedding) ||
            embedding.length === 0 ||
            embedding.some((value) => !Number.isFinite(value)),
        )
      ) {
        throw new Error('Ollama devolvió embeddings no válidos para el documento.');
      }

      chunks.push(
        ...batch.map((chunk, index) => ({ text: chunk, embedding: response.embeddings[index] })),
      );
    }

    this.indexedDocument = { chunks };
    return { file_name: file.name, characters: text.length, chunks: chunks.length };
  }

  private async generateAnswer(question: string): Promise<AnswerResult> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      throw new Error('La pregunta no puede estar vacía.');
    }
    if (normalizedQuestion.length > MAX_QUESTION_LENGTH) {
      throw new Error(`La pregunta no puede superar los ${MAX_QUESTION_LENGTH} caracteres.`);
    }
    if (!this.indexedDocument) {
      throw new Error('Sube y procesa un documento antes de hacer una pregunta.');
    }

    const embeddingResponse = await firstValueFrom(
      this.http.post<EmbeddingResponse>(`${this.apiUrl}/embed`, {
        model: 'nomic-embed-text',
        input: normalizedQuestion,
      }),
    );
    const questionEmbedding = embeddingResponse.embeddings?.[0];
    if (
      !Array.isArray(questionEmbedding) ||
      questionEmbedding.length === 0 ||
      questionEmbedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error('Ollama devolvió un embedding no válido para la pregunta.');
    }

    const context = this.indexedDocument.chunks
      .map((chunk) => ({
        text: chunk.text,
        score: this.cosineSimilarity(questionEmbedding, chunk.embedding),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, RETRIEVAL_COUNT)
      .map((chunk) => chunk.text)
      .join('\n\n');

    const response = await firstValueFrom(
      this.http.post<ChatResponse>(`${this.apiUrl}/chat`, {
        model: 'llama3:8b',
        stream: false,
        options: { temperature: 0 },
        messages: [
          {
            role: 'system',
            content:
              'Responde a la pregunta usando solo la información proporcionada. Si el documento no contiene la respuesta, indícalo claramente.',
          },
          { role: 'user', content: `Documento:\n${context}\n\nPregunta: ${normalizedQuestion}` },
        ],
      }),
    );

    if (typeof response.message?.content !== 'string' || !response.message.content.trim()) {
      throw new Error('Ollama no devolvió una respuesta.');
    }
    return { answer: response.message.content };
  }

  private async readDocument(file: File): Promise<string> {
    const content = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      throw new Error('El fichero debe estar codificado en UTF-8.');
    }

    text = text.replace(/^\uFEFF/, '');
    if (!text.trim()) {
      throw new Error('El fichero no contiene texto.');
    }
    return text;
  }

  private splitIntoChunks(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + CHUNK_SIZE, text.length);
      if (end < text.length) {
        const minimumBoundary = start + Math.floor(CHUNK_SIZE / 2);
        const boundary = Math.max(
          text.lastIndexOf('\n\n', end),
          text.lastIndexOf('\n', end),
          text.lastIndexOf(' ', end),
        );
        if (boundary >= minimumBoundary) {
          end = boundary;
        }
      }

      const chunk = text.slice(start, end).trim();
      if (chunk) {
        chunks.push(chunk);
      }
      if (end >= text.length) {
        break;
      }
      start = Math.max(start + 1, end - CHUNK_OVERLAP);
    }

    return chunks;
  }

  private cosineSimilarity(left: number[], right: number[]): number {
    if (left.length !== right.length) {
      throw new Error('Ollama devolvió embeddings con dimensiones incompatibles.');
    }

    let dotProduct = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
      dotProduct += left[index] * right[index];
      leftMagnitude += left[index] * left[index];
      rightMagnitude += right[index] * right[index];
    }

    const denominator = Math.sqrt(leftMagnitude * rightMagnitude);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
