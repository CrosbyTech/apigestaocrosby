package br.com.crosby.balancorfid;

/**
 * Driver de uma pistola RFID. Cada marca (Urovo, Bluebird) implementa esta
 * interface; a RfidBridge escolhe qual usar e fala com a página.
 * Os métodos podem ser chamados de qualquer thread — cada driver decide em qual
 * thread conversa com o SDK. As respostas voltam pelo {@link Ouvinte}.
 */
interface Leitor {
    /** "urovo" | "bluebird" */
    String marca();

    /** Conecta. mac == null: automático (pistola encaixada / última pareada). */
    void conectar(String mac);

    void desconectar();

    /** Começa o inventário contínuo; o resultado vem por {@link Ouvinte#aoEstado}. */
    void iniciar();

    void pausar();

    /** Potência atual e máxima em dBm (-1 se indisponível) — por {@link Ouvinte#aoPotencia}. */
    void lerPotencia();

    void definirPotencia(int dbm);

    String versaoSdk();

    void liberar();

    interface Ouvinte {
        /** conectado/lendo mudaram; erro == null quando ok. modo: "pinos" | "bluetooth". */
        void aoEstado(boolean conectado, boolean lendo, String erro, String modo);

        void aoLerTag(String epc, int rssi);

        void aoGatilho(int tecla, boolean apertado);

        void aoBateria(int nivel, boolean carregando);

        /** Estado físico da pistola (Urovo: 0 encaixada · 1 separada · 2 ligando · 3 desligada). */
        void aoModulo(int status);

        void aoPotencia(int atual, int max, int resultado);
    }
}
