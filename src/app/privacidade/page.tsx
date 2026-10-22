import type { Metadata } from 'next';
import Link from 'next/link';
import './privacidade.css';

export const metadata: Metadata = {
  title: 'Política de Privacidade — Resultados Brasil',
  description:
    'Quais dados o Resultados Brasil coleta, para quê, com quem compartilha, por quanto tempo guarda e como exercer seus direitos pela LGPD.',
};

const CONTACT = 'resultadobrasil@gmail.com';
const UPDATED = '21 de outubro de 2026';

/** Plain-language privacy policy, written from what the site actually stores (LGPD, Lei 13.709/2018). */
export default function PrivacyPage() {
  return (
    <main className="privacy" id="conteudo">
      <article className="privacy-card">
        <p className="privacy-eyebrow">Resultados Brasil · Eleições 2026</p>
        <h1>Política de Privacidade</h1>
        <p className="privacy-updated">Última atualização: {UPDATED}</p>

        <p>
          Esta política explica, em linguagem simples, quais dados pessoais o{' '}
          <b>Resultados Brasil</b> (portaleleicao.com.br) trata, para quê, com quem compartilha, por
          quanto tempo guarda e como você pode exercer seus direitos, conforme a Lei Geral de
          Proteção de Dados (LGPD, Lei nº 13.709/2018).
        </p>

        <h2>1. Quem é o responsável</h2>
        <p>
          O controlador dos dados é o <b>Resultados Brasil</b>, painel independente de
          acompanhamento da apuração, sem vínculo com o Tribunal Superior Eleitoral (TSE). Para
          qualquer assunto sobre seus dados, inclusive falar com o encarregado (DPO), escreva para{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <h2>2. Quais dados tratamos</h2>
        <h3>Ao visitar o site, sem conta</h3>
        <ul>
          <li>
            Um <b>identificador de visitante</b> (aparece no chat como &quot;Visitante&quot; e um
            número) e o <b>tempo de uso gratuito</b> já consumido.
          </li>
          <li>
            <b>Cookies técnicos</b> (veja o item 6) e o <b>endereço IP</b>, usado apenas por alguns
            minutos para limitar abusos (excesso de tentativas, robôs). Não guardamos histórico de
            navegação.
          </li>
        </ul>
        <h3>Ao criar uma conta</h3>
        <ul>
          <li>
            <b>E-mail</b> e <b>senha</b>. A senha nunca é guardada como texto: guardamos apenas uma
            versão cifrada (hash scrypt), que não permite recuperá-la.
          </li>
          <li>
            <b>Nome de usuário</b>, que aparece publicamente no chat.
          </li>
          <li>
            <b>Partido que você apoia</b>, se decidir informar. Opinião política é{' '}
            <b>dado pessoal sensível</b> (art. 11 da LGPD): só é guardada com o seu consentimento
            expresso, dado no cadastro, e serve apenas para mostrar o selo (13 ou 22) junto do seu
            nome no chat. Você pode escolher &quot;Prefiro não informar&quot;.
          </li>
          <li>
            <b>Foto de perfil</b>, se você enviar. Ela é recortada e regravada pelo servidor, o que
            remove dados embutidos na imagem, como a localização.
          </li>
          <li>
            Dados de uso da conta: data de criação, último acesso, tempo gratuito usado, número de
            trocas de aparelho (para identificar contas compartilhadas) e saldo de figurinhas.
          </li>
        </ul>
        <h3>No chat</h3>
        <ul>
          <li>
            As <b>mensagens e figurinhas</b> que você envia são públicas para quem está no chat, com
            seu nome de usuário, seu selo de partido (se houver) e sua foto.
          </li>
          <li>As denúncias que você faz de mensagens de outras pessoas.</li>
        </ul>
        <h3>Ao pagar</h3>
        <ul>
          <li>
            Registro do pagamento: valor, forma (Pix ou cartão), situação, data e o que foi comprado
            (acesso ou pacote de figurinhas).
          </li>
          <li>
            <b>Não recebemos nem guardamos os dados do seu cartão.</b> O formulário de cartão é do
            Mercado Pago: o número vai direto do seu navegador para ele, e nós recebemos apenas um
            código de autorização. No Pix, o pagamento acontece no app do seu banco.
          </li>
        </ul>
        <h3>No aviso de início da apuração</h3>
        <ul>
          <li>
            Se você pedir para ser avisado, guardamos o <b>e-mail</b> informado, usado só para esse
            aviso.
          </li>
        </ul>

        <h2>3. Para que usamos e com qual base legal</h2>
        <ul>
          <li>
            <b>Prestar o serviço que você contratou</b> (painel, chat, acesso pago, figurinhas):
            execução de contrato (art. 7º, V).
          </li>
          <li>
            <b>Segurança e prevenção de fraudes</b> (limite de tentativas, sessão única por conta,
            moderação do chat, registro das ações da moderação): legítimo interesse (art. 7º, IX) e
            proteção do crédito no caso de pagamentos (art. 7º, X).
          </li>
          <li>
            <b>Partido apoiado</b>: consentimento específico e destacado (art. 11, I).
          </li>
          <li>
            <b>Aviso de início da apuração</b>: consentimento (art. 7º, I).
          </li>
          <li>
            <b>Registros financeiros</b>: cumprimento de obrigação legal (art. 7º, II).
          </li>
        </ul>
        <p>
          Não vendemos seus dados, não fazemos publicidade direcionada e não usamos seus dados para
          perfis de comportamento.
        </p>

        <h2>4. Com quem compartilhamos</h2>
        <ul>
          <li>
            <b>Mercado Pago</b>: para processar pagamentos por Pix e cartão. Enviamos o valor, a
            descrição da compra, seu e-mail e um código interno da sua conta.
          </li>
          <li>
            <b>DigitalOcean</b>: empresa onde ficam os servidores e o banco de dados do site.
          </li>
          <li>
            <b>Autoridades</b>, quando houver obrigação legal ou ordem judicial.
          </li>
        </ul>
        <p>
          Os resultados eleitorais e as fotos dos candidatos são públicos e vêm do TSE; não envolvem
          dados seus.
        </p>

        <h2>5. Transferência internacional</h2>
        <p>
          Os servidores do site ficam nos Estados Unidos (DigitalOcean, região de Nova York). A
          transferência é necessária para prestar o serviço (art. 33, IX, da LGPD) e o provedor
          adota medidas de segurança compatíveis com a lei.
        </p>

        <h2>6. Cookies</h2>
        <p>
          Usamos apenas cookies necessários ao funcionamento. Não usamos cookies de publicidade.
        </p>
        <ul>
          <li>
            <code>rb_session</code>: mantém você conectado (até 30 dias).
          </li>
          <li>
            <code>rb_guest</code>: lembra o visitante deste navegador, para o tempo gratuito não
            recomeçar (até 1 ano).
          </li>
          <li>
            <code>rb_lb</code>: mantém sua conexão no mesmo servidor, para o site responder mais
            rápido.
          </li>
        </ul>

        <h2>7. Por quanto tempo guardamos</h2>
        <ul>
          <li>
            Conta, perfil, foto e mensagens: enquanto a conta existir ou até você pedir a exclusão.
          </li>
          <li>
            Registros de pagamento: pelo prazo exigido pela legislação fiscal e contábil, mesmo após
            a exclusão da conta (sem os seus dados de perfil).
          </li>
          <li>
            E-mail do aviso de início da apuração: até o aviso ser enviado ou você pedir a remoção.
          </li>
          <li>Endereço IP para limite de tentativas: alguns minutos.</li>
        </ul>
        <p>
          Quando uma conta é excluída, apagamos e-mail, nome, nome de usuário, partido, foto e
          mensagens no chat. Esse e-mail não poderá ser usado de novo para entrar ou criar outra
          conta.
        </p>

        <h2>8. Seus direitos</h2>
        <p>Pela LGPD (art. 18), você pode, a qualquer momento:</p>
        <ul>
          <li>confirmar se tratamos seus dados e ter acesso a eles;</li>
          <li>corrigir dados incompletos ou desatualizados;</li>
          <li>pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários;</li>
          <li>pedir a portabilidade dos seus dados;</li>
          <li>
            <b>revogar o consentimento</b>, por exemplo, para que o seu partido deixe de aparecer no
            chat;
          </li>
          <li>pedir a exclusão da sua conta e dos seus dados;</li>
          <li>saber com quem compartilhamos seus dados.</li>
        </ul>
        <p>
          Para exercer qualquer direito, escreva para <a href={`mailto:${CONTACT}`}>{CONTACT}</a> a
          partir do e-mail da sua conta. Respondemos em até 15 dias. Você também pode reclamar à
          Autoridade Nacional de Proteção de Dados (ANPD).
        </p>

        <h2>9. Segurança</h2>
        <p>
          O site usa conexão cifrada (HTTPS). Senhas são guardadas apenas como hash. O banco de
          dados fica numa rede privada, sem acesso pela internet, e os acessos administrativos são
          restritos e registrados. Nenhum sistema é totalmente imune a falhas; se ocorrer um
          incidente com risco relevante, avisaremos você e a ANPD.
        </p>

        <h2>10. Crianças e adolescentes</h2>
        <p>
          O serviço é voltado a maiores de 18 anos. Se soubermos que uma conta pertence a menor de
          idade sem autorização dos responsáveis, ela será excluída.
        </p>

        <h2>11. Mudanças nesta política</h2>
        <p>
          Podemos atualizar esta política. A data da última atualização aparece no topo; mudanças
          importantes serão avisadas no site.
        </p>

        <p className="privacy-back">
          <Link href="/">← Voltar para a apuração</Link>
        </p>
      </article>
    </main>
  );
}
