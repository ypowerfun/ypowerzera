import "./viradao.css";
import type { Metadata } from 'next';
import ViradaoApp from './viradao-app';
export const metadata:Metadata={title:'Viradão — Prime Arena',description:'Veja quem vai participar do Viradão da Prime Arena.'};
export default function Page(){return <ViradaoApp/>;}
