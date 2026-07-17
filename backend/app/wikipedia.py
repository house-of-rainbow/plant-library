"""Wikipedia client used for plant-species enrichment.

This client searches Wikipedia for a likely page title, fetches the full page
HTML through the MediaWiki API, converts it to plain text, and returns a prompt
ready reference context for downstream LLM enrichment.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx
from bs4 import BeautifulSoup


_WIKIPEDIA_HEADERS = {"User-Agent": "plant-library/0.1"}


@dataclass(slots=True)
class WikipediaArticle:
    query: str
    title: str
    url: str
    text: str


class WikipediaClient:
    def __init__(self, timeout: float = 20.0) -> None:
        self._timeout = timeout

    async def get_article(
        self,
        query: str,
        *,
        max_chars: int = 12000,
    ) -> WikipediaArticle | None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            return await self.resolve_article(
                client,
                query,
                max_chars=max_chars,
            )

    async def search_title(self, client: httpx.AsyncClient, query: str) -> str | None:
        query = query.strip()
        if not query:
            return None

        resp = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "format": "json",
                "utf8": 1,
                "srlimit": 1,
            },
            headers=_WIKIPEDIA_HEADERS,
        )
        resp.raise_for_status()
        results = (resp.json().get("query") or {}).get("search") or []
        if not results:
            return None
        return results[0].get("title")

    async def fetch_article(
        self,
        client: httpx.AsyncClient,
        *,
        query: str,
        title: str,
        max_chars: int = 12000,
    ) -> WikipediaArticle | None:
        resp = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "parse",
                "page": title,
                "prop": "text",
                "format": "json",
                "formatversion": 2,
                "redirects": 1,
            },
            headers=_WIKIPEDIA_HEADERS,
        )
        resp.raise_for_status()
        payload = resp.json().get("parse") or {}
        html = payload.get("text")
        page_title = payload.get("title") or title
        if not html:
            return None

        soup = BeautifulSoup(html, "html.parser")
        for selector in [
            "table",
            ".hatnote",
            ".navbox",
            ".reflist",
            ".reference",
            ".mw-editsection",
            "sup",
            "style",
            "script",
        ]:
            for node in soup.select(selector):
                node.decompose()

        text = soup.get_text("\n", strip=True)
        text = "\n".join(line for line in text.splitlines() if line.strip())
        if not text:
            return None

        return WikipediaArticle(
            query=query,
            title=page_title,
            url=f"https://en.wikipedia.org/wiki/{quote(page_title.replace(' ', '_'), safe='')}",
            text=text[:max_chars],
        )

    async def resolve_article(
        self,
        client: httpx.AsyncClient,
        query: str,
        *,
        max_chars: int = 12000,
    ) -> WikipediaArticle | None:
        title = await self.search_title(client, query)
        if not title:
            return None
        return await self.fetch_article(
            client,
            query=query,
            title=title,
            max_chars=max_chars,
        )

    async def build_reference_context(
        self,
        candidates: list[Any],
        *,
        max_articles: int = 4,
        max_chars_per_article: int = 12000,
    ) -> tuple[str, dict[str, WikipediaArticle]]:
        queries: list[str] = []
        seen: set[str] = set()
        for candidate in candidates:
            for raw in [
                getattr(candidate, "scientific_name_without_author", None),
                getattr(candidate, "scientific_name", None),
                getattr(candidate, "common_name", None),
            ]:
                query = (raw or "").strip()
                if not query:
                    continue
                key = query.lower()
                if key in seen:
                    continue
                seen.add(key)
                queries.append(query)
                break
            if len(queries) >= max_articles:
                break

        references: dict[str, WikipediaArticle] = {}
        lines: list[str] = []
        if not queries:
            return "", references

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for query in queries:
                article = await self.resolve_article(
                    client,
                    query,
                    max_chars=max_chars_per_article,
                )
                if article is None:
                    continue
                references[query.lower()] = article
                lines.append(
                    f"Article: {article.title}\n"
                    f"Source: {article.url}\n"
                    f"Content:\n{article.text}"
                )

        return "\n\n---\n\n".join(lines), references


def candidate_lookup_keys(candidate: Any) -> list[str]:
    return [
        value.strip().lower()
        for value in [
            getattr(candidate, "scientific_name_without_author", None),
            getattr(candidate, "scientific_name", None),
            getattr(candidate, "common_name", None),
        ]
        if value and value.strip()
    ]


def apply_reference_metadata(candidates: list[Any], references: dict[str, WikipediaArticle]) -> None:
    for candidate in candidates:
        for key in candidate_lookup_keys(candidate):
            article = references.get(key)
            if article is None:
                continue
            if not getattr(candidate, "description", None):
                setattr(candidate, "description", article.text[:1200])
            if not getattr(candidate, "reference_url", None):
                setattr(candidate, "reference_url", article.url)
            break