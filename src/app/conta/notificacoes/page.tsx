import type { Metadata } from "next";
import Link from "next/link";
import { markNotificationsReadAction } from "@/app/actions/account";
import { Card, Empty, PageTitle, buttonClass, cx } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Notificações" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser("/conta/notificacoes");
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 60 });
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Notificações" subtitle={unread ? `${unread} não lida(s)` : "Tudo em dia"} actions={unread ? <form action={markNotificationsReadAction}><button className={buttonClass("secondary")}>Marcar todas como lidas</button></form> : null} />
      {items.length === 0 ? <Empty title="Nada por aqui ainda" /> : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={n.id} className={cx("py-3", !n.readAt && "border-brand/50")}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-sm font-semibold">{n.href ? <Link href={n.href} className="hover:text-brand-soft">{n.title}</Link> : n.title}</p><p className="text-sm text-muted">{n.body}</p></div>
                <span className="shrink-0 text-xs text-muted">{formatDateTime(n.createdAt)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
