# RAG Docs — Angular 21

Aplicación Angular para consultar documentos `.txt` usando Ollama. El navegador lee y fragmenta el documento, genera sus embeddings, busca los fragmentos más relevantes y solicita una respuesta al modelo. No necesita un backend propio; el documento y sus vectores se mantienen en memoria en la pestaña actual.

## Requisitos

- Node.js compatible con Angular 21 (Node.js 20.19 o posterior).
- Ollama instalado y en ejecución.
- Los modelos de Ollama:

  ```powershell
  ollama pull nomic-embed-text
  ollama pull llama3:8b
  ```

## Permitir conexiones desde Angular

Angular se conecta directamente a Ollama en `http://localhost:11434`. Para permitir la conexión desde el origen local de Angular, configura esta variable de entorno de usuario en PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "http://localhost:4200", "User")
```

Reinicia Ollama después de cambiar la variable. Si ejecutas Angular en `http://127.0.0.1:4200`, añade también ese origen a `OLLAMA_ORIGINS`.

## Ejecución

Desde la carpeta del proyecto:

```powershell
npm install
npm start
```

Abre <http://localhost:4200>. Se acepta un único documento `.txt` de hasta 5 MB; al cargar otro, reemplaza el anterior. El documento no se guarda en disco y desaparece al recargar o cerrar la pestaña. Si Ollama no está disponible, los modelos no están instalados o el origen no está permitido, la interfaz muestra un error.

## Verificación

```powershell
npm run build
npm test
```
