import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';

const App = () => {
  const [results, setResults] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [tempoEstimadoTotal, setTempoEstimadoTotal] = useState(0);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!processing && results.length > 0) {
      salvarResultados();
    }
    // eslint-disable-next-line
  }, [processing, results]);

  const fetchCnpjData = async (cnpj) => {
    const url = `https://receitaws.com.br/v1/cnpj/${cnpj}`;
    const maxTentativas = 3;
    let tentativaAtual = 1;

    while (tentativaAtual <= maxTentativas) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Erro na requisição para CNPJ ${cnpj}: ${response.status}`);
        }
        const data = await response.json();
        if (data.cnpj && data.situacao) {
          return { cnpj: data.cnpj, situacao: data.situacao };
        } else {
          throw new Error(`Resposta inválida para CNPJ ${cnpj}`);
        }
      } catch (error) {
        if (tentativaAtual < maxTentativas && error.message.includes('429')) {
          const tempoDeEspera = Math.pow(2, tentativaAtual) * 30000;
          console.log(`Aguardando ${tempoDeEspera / 1000} segundos antes da próxima tentativa...`);
          await new Promise(resolve => setTimeout(resolve, tempoDeEspera));

          if (tentativaAtual % 3 === 0) {
            console.log('Aguardando 60 segundos adicionais...');
            await new Promise(resolve => setTimeout(resolve, 60000));
          }
        } else {
          console.error(`Erro ao processar CNPJ ${cnpj}: ${error.message}`);
          return null;
        }
      }
      tentativaAtual++;
    }

    console.error(`Falha após ${maxTentativas} tentativas para CNPJ ${cnpj}`);
    return null;
  };

  const fetchCnpjDataBatchWithInterval = async (cnpjBatch) => {
    const resultados = [];
    for (const cnpj of cnpjBatch) {
      const resultado = await fetchCnpjData(cnpj);
      resultados.push(resultado);
    }
    return resultados;
  };

  const processarLotes = async (cnpjs) => {
    const tamanhoDoLote = 3;
    const totalLotes = Math.ceil(cnpjs.length / tamanhoDoLote);
    let loteAtual = 1;
    let tempoEstimadoTotal = totalLotes * 60 * 1000; // Tempo estimado total em milissegundos

    if (!cnpjs || cnpjs.length === 0) {
      console.error('Nenhum CNPJ encontrado para processar.');
      return;
    }

    const resultadosFinais = [];

    for (let i = 0; i < cnpjs.length; i += tamanhoDoLote) {
      const lote = cnpjs.slice(i, i + tamanhoDoLote);

      console.log(`Processando lote ${loteAtual} de ${totalLotes}...`);
      const resultadosDoLote = await fetchCnpjDataBatchWithInterval(lote);
      resultadosFinais.push(...resultadosDoLote);

      if (i + tamanhoDoLote < cnpjs.length) {
        const tempoDeEspera = 60 * 1000; // Tempo de espera por lote em milissegundos
        console.log(`Aguardando ${tempoDeEspera / 1000} segundos antes do próximo lote ${loteAtual + 1}...`);
        await new Promise(resolve => setTimeout(resolve, tempoDeEspera));
        tempoEstimadoTotal -= tempoDeEspera;
        setTempoEstimadoTotal(tempoEstimadoTotal);
        console.log(`Tempo estimado total: ${tempoEstimadoTotal / 60000} minutos.`);
      }

      loteAtual++;
    }

    console.log(resultadosFinais);
    return resultadosFinais;
  };

  const lerArquivo = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        const content = event.target.result;

        if (content.startsWith('PK')) {
          try {
            const data = new Uint8Array(content.split('').map(char => char.charCodeAt(0)));
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];

            if (!sheet) {
              console.error('Nenhuma planilha encontrada no arquivo XLSX.');
              reject(new Error('Nenhuma planilha encontrada no arquivo XLSX.'));
              return;
            }

            const cnpjs = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 })
              .filter(item => item[1] !== '');

            resolve(cnpjs);
          } catch (error) {
            console.error('Erro ao processar o arquivo XLSX:', error);
            reject(error);
          }
        } else {
          console.log('Conteúdo bruto do arquivo (não é um arquivo XLSX):', content);
          const cnpjsArray = content.split('\n').map(cnpj => cnpj.trim()).filter(cnpj => cnpj !== '');
          resolve(cnpjsArray);
        }
      };

      reader.onerror = (error) => {
        reject(error);
      };

      reader.readAsBinaryString(file);
    });
  };

  const processarCnpjs = async () => {
    setProcessing(true);

    const selectedFile = fileInputRef.current.files[0];

    if (!selectedFile) {
      console.error('Nenhum arquivo selecionado.');
      return;
    }

    try {
      const cnpjs = await lerArquivo(selectedFile);

      if (cnpjs.length === 0) {
        console.error('Nenhum CNPJ encontrado no arquivo.');
        return;
      }

      console.log('CNPJs lidos do arquivo:', cnpjs);

      const resultados = await processarLotes(cnpjs);
      setResults(resultados);

      if (resultados.length > 0) {
        salvarResultados();
      }
    } catch (error) {
      console.error('Erro ao processar CNPJs:', error);
    } finally {
      setProcessing(false);
    }
  };

  const salvarResultados = async () => {
    if (results.length === 0) {
      console.error('Nenhum resultado para salvar.');
      return;
    }
  
    // Armazenar resultados no localStorage
    localStorage.setItem('resultados', JSON.stringify(results));
  
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(results);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Resultados');
  
    try {
      await XLSX.writeFile(workbook, 'resultados.xlsx');
      console.log('Resultados salvos com sucesso!');
      
      // Limpar resultados do localStorage após salvar no arquivo
      localStorage.removeItem('resultados');
    } catch (error) {
      console.error('Erro ao salvar resultados:', error);
    }
  };

  return (
    <div>
    <input type="file" ref={fileInputRef} />
    <button onClick={processarCnpjs} disabled={processing}>
      Processar CNPJs
    </button>

    <div>
      <h2>Resultados:</h2>
      <pre>{JSON.stringify(results, null, 2)}</pre>
    </div>

    <div>
      <p>Tempo estimado total: {tempoEstimadoTotal / 60000} minutos</p>
    </div>

    <button onClick={salvarResultados} disabled={processing}>
      Salvar Resultados
    </button>
  </div>
);
};




export default App;