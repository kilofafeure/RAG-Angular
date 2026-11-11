import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { DocumentUpload, RagApiService } from './services/rag-api.service';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly uploadedDocument = signal<DocumentUpload | null>(null);
  protected readonly uploadPending = signal(false);
  protected readonly questionPending = signal(false);
  protected readonly answer = signal('');
  protected readonly errorMessage = signal('');
  protected question = '';

  constructor(private readonly ragApi: RagApiService) {}

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) {
      return;
    }

    this.errorMessage.set('');
    this.answer.set('');
    this.uploadedDocument.set(null);

    if (!file.name.toLowerCase().endsWith('.txt')) {
      this.selectedFile.set(null);
      this.errorMessage.set('Selecciona un fichero de texto con extensión .txt.');
      return;
    }

    if (file.size === 0) {
      this.selectedFile.set(null);
      this.errorMessage.set('El fichero está vacío. Selecciona un documento con contenido.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      this.selectedFile.set(null);
      this.errorMessage.set('El fichero supera el límite de 5 MB.');
      return;
    }

    this.selectedFile.set(file);
    this.uploadPending.set(true);

    this.ragApi
      .uploadDocument(file)
      .pipe(finalize(() => this.uploadPending.set(false)))
      .subscribe({
        next: (document) => this.uploadedDocument.set(document),
        error: (error: unknown) => this.errorMessage.set(this.describeError(error)),
      });
  }

  protected onQuestionInput(event: Event): void {
    this.question = (event.target as HTMLInputElement).value;
  }

  protected submitQuestion(event: Event): void {
    event.preventDefault();
    const question = this.question.trim();

    if (!question) {
      this.errorMessage.set('Escribe una pregunta antes de continuar.');
      return;
    }

    if (!this.uploadedDocument()) {
      this.errorMessage.set('Sube un documento .txt y espera a que termine de procesarse.');
      return;
    }

    this.errorMessage.set('');
    this.answer.set('');
    this.questionPending.set(true);

    this.ragApi
      .askQuestion(question)
      .pipe(finalize(() => this.questionPending.set(false)))
      .subscribe({
        next: (result) => this.answer.set(result.answer),
        error: (error: unknown) => this.errorMessage.set(this.describeError(error)),
      });
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const ollamaError = this.getOllamaError(error.error);
      if (ollamaError) {
        return ollamaError;
      }

      if (error.status === 0) {
        return 'No se pudo conectar con Ollama en http://localhost:11434. Comprueba que está en ejecución y que OLLAMA_ORIGINS permite http://localhost:4200.';
      }

      return `Ollama no pudo completar la operación (error ${error.status}).`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Ha ocurrido un error inesperado. Inténtalo de nuevo.';
  }

  private getOllamaError(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
      return '';
    }

    return typeof payload.error === 'string' ? payload.error : '';
  }
}
