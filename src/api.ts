import { FormData } from "formdata-node";
import type {
    KVNamespaceListOptions,
    KVNamespaceListResult,
    KVNamespacePutOptions,
    KVNamespaceGetOptions,
    KVNamespace,
} from "@cloudflare/workers-types";

export const KvStorage = class<Key extends string = string> implements KVNamespace {
    accountId?: string;
    apiToken?: string;
    namespaceId: string;

    constructor(kvStorageNamespaceId: string, cloudflareAccountId: string, cloudflareApiToken: string) {
        this.accountId = cloudflareAccountId;
        this.apiToken = cloudflareApiToken;
        this.namespaceId = kvStorageNamespaceId;
    }

    getNamespaceUrl() {
        return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}`;
    }

    getUrlForKey(key: string) {
        return new URL(`${this.getNamespaceUrl()}/values/${key}`);
    }

    getUrlForMetadata(key: string) {
        return new URL(`${this.getNamespaceUrl()}/metadata/${key}`);
    }

    getAuthHeaders() {
        const headers: Record<string, string> = {};
        // if (this.authEmail) headers["X-Auth-Email"] = this.authEmail;
        // if (this.authKey) headers["X-Auth-Key"] = this.authKey;
        if (this.apiToken) {
            headers["Authorization"] = `Bearer ${this.apiToken}`;
        }
        return headers;
    }

    async list<Metadata = unknown>(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult<Metadata, Key>> {
        const { prefix, limit, cursor } = options || {};
        const url = new URL(`${this.getNamespaceUrl()}/keys`);

        const searchParams = new URLSearchParams();

        if (prefix) {
            searchParams.append("prefix", prefix);
        }

        if (limit) {
            searchParams.append("limit", String(limit));
        }

        if (cursor) {
            searchParams.append("cursor", cursor);
        }

        url.search = searchParams.toString();

        // eslint-disable-next-line no-undef
        const response = await fetch(url, {
            headers: this.getAuthHeaders(),
        });

        if (response.ok) {
            const body = await response.json();

            return {
                keys: body.result,
                list_complete: body.result_info.count < (limit || 1000),
                cursor: body.result_info.cursor,
                cacheStatus: null,
            };
        }

        return {
            keys: [],
            list_complete: true,
            cacheStatus: null,
        };
    }

    async get(key: Key, typeOrOptions?: string | Partial<KVNamespaceGetOptions<any>>) {
        const url = this.getUrlForKey(key);

        // eslint-disable-next-line no-undef
        const response = await fetch(url, {
            headers: this.getAuthHeaders(),
        });

        if (response.ok) {
            switch (typeOrOptions) {
                case "json":
                    return response.json() as Promise<any>;
                case "stream":
                    return response.body;
                case "arraybuffer":
                    return response.arrayBuffer();
                default:
                    return response.text();
            }
        }

        return null;
    }

    async getMetadata(key: Key) {
        const url = this.getUrlForMetadata(key);

        // eslint-disable-next-line no-undef
        const response = await fetch(url, {
            headers: this.getAuthHeaders(),
        });

        const result = (await response.json()) as {
            result: any;
            success: boolean;
            errors: [];
            messages: [];
        };

        return result.result;
    }

    async getWithMetadata(key: Key, typeOrOptions: any) {
        const [value, metadata] = await Promise.all([this.get(key, typeOrOptions), this.getMetadata(key)]);

        return {
            value,
            metadata,
            cacheStatus: null,
        };
    }

    async put(key: Key, value: string | ArrayBuffer | ArrayBufferView, options?: KVNamespacePutOptions) {
        const { expiration, expirationTtl, metadata } = options || {};

        const url = this.getUrlForKey(key);
        const searchParams = new URLSearchParams();

        if (expiration) {
            searchParams.append("expiration", String(expiration));
        } else if (expirationTtl) {
            searchParams.append("expiration_ttl", String(expirationTtl));
        }

        const headers = this.getAuthHeaders();

        url.search = searchParams.toString();

        if (!metadata) {
            // https://api.cloudflare.com/#workers-kv-namespace-write-key-value-pair
            // eslint-disable-next-line no-undef
            await fetch(url.toString(), {
                method: "PUT",
                headers: { ...headers },
                body: value,
            });
        }

        // https://api.cloudflare.com/#workers-kv-namespace-write-key-value-pair-with-metadata
        const formData = new FormData();
        formData.append("value", value);
        formData.append("metadata", JSON.stringify(metadata));

        await fetch(url.toString(), {
            method: "PUT",
            headers: headers,
            body: formData as BodyInit,
        });
    }

    async delete(key: Key) {
        const url = this.getUrlForKey(key);

        await fetch(url, {
            headers: this.getAuthHeaders(),
            method: "DELETE",
        });
    }
};
