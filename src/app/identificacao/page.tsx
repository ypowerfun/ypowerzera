import type { Metadata } from 'next';
import { getChatGPTUser, chatGPTSignInPath } from '@/server/chatgpt-auth';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Identificação da conta — Prime Arena', robots: { index: false, follow: false } };
export default async function IdentificationPage() {
  const user = await getChatGPTUser();
  return <main style={{maxWidth:720,margin:'64px auto',padding:24,color:'#f4f4f5',background:'#111114',border:'1px solid #38383c',borderRadius:16}}>
    <h1 style={{fontSize:28,fontWeight:800}}>Identificação da sua conta</h1>
    {user ? <>
      <p style={{marginTop:20}}>Você está conectado como <strong>{user.email}</strong>.</p>
      <p style={{marginTop:16}}>Copie o identificador abaixo e envie no chat em que está atualizando a Prime Arena. Ele permite vincular seu acesso administrativo à conta correta.</p>
      <code style={{display:'block',marginTop:20,padding:16,background:'#050506',border:'1px solid #a91c29',borderRadius:8,overflowWrap:'anywhere',userSelect:'all'}}>{user.userId}</code>
      <p style={{marginTop:16,color:'#b5b5bf'}}>Este código identifica sua conta neste site. Ele não é sua senha e, sozinho, não concede acesso administrativo.</p>
    </> : <>
      <p style={{marginTop:20}}>Entre com a conta ChatGPT que você quer usar para administrar a Prime Arena.</p>
      <a href={chatGPTSignInPath('/identificacao')} target="_top" style={{display:'inline-block',marginTop:20,padding:'12px 20px',background:'#bd1830',borderRadius:8,color:'white',fontWeight:700}}>Entrar com ChatGPT</a>
    </>}
    <p style={{marginTop:28}}><a href="/" style={{color:'#ddd'}}>Voltar ao site</a></p>
  </main>;
}
