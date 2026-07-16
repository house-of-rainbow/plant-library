"""Cosmos-backed repositories.

All containers are partitioned by ``/property_id`` so a whole tenant lives in a
single logical partition. The ``tenancy`` container multiplexes several
document types (``property``, ``garden``, ``membership``, ``tag``) by a
``doc_type`` discriminator.
"""
from __future__ import annotations

from datetime import datetime, timezone

from azure.cosmos.exceptions import CosmosResourceNotFoundError

from .db import Database
from .models import (
    Garden,
    GardenCreate,
    GardenUpdate,
    MemberRole,
    Membership,
    PlantClass,
    PlantClassCreate,
    PlantClassUpdate,
    PlantInstance,
    PlantInstanceCreate,
    PlantInstanceUpdate,
    Property,
    PropertyCreate,
    PropertyUpdate,
    Tag,
    TagCreate,
    TagScope,
    TagUpdate,
    _norm_email,
    new_membership_id,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Tenancy: properties, gardens, memberships
# --------------------------------------------------------------------------- #
class TenancyRepository:
    def __init__(self, db: Database) -> None:
        self._c = db.tenancy

    # ---- properties ---- #
    async def create_property(
        self,
        payload: PropertyCreate,
        owner_oid: str,
        owner_email: str | None,
        owner_name: str | None = None,
    ) -> Property:
        entity = Property(
            name=payload.name,
            address=payload.address,
            owner_oid=owner_oid,
            owner_email=(_norm_email(owner_email) if owner_email else None),
        )
        entity.property_id = entity.id
        await self._c.create_item(body=entity.model_dump(mode="json"))

        # The creator is always the owner.
        owner = Membership(
            property_id=entity.id,
            user_oid=owner_oid,
            user_email=(_norm_email(owner_email) if owner_email else ""),
            user_name=owner_name,
            role=MemberRole.owner,
        )
        await self._c.create_item(body=owner.model_dump(mode="json"))
        return entity

    async def get_property(self, property_id: str) -> Property | None:
        try:
            item = await self._c.read_item(item=property_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return None
        if item.get("doc_type") != "property":
            return None
        return Property(**item)

    async def list_all_properties(self) -> list[Property]:
        query = "SELECT * FROM c WHERE c.doc_type = 'property' ORDER BY c.created_at ASC"
        return [Property(**i) async for i in self._c.query_items(query=query)]

    async def update_property(
        self, property_id: str, payload: PropertyUpdate
    ) -> Property | None:
        current = await self.get_property(property_id)
        if current is None:
            return None
        data = current.model_dump()
        data.update(payload.model_dump(exclude_unset=True))
        data["updated_at"] = _now()
        updated = Property(**data)
        await self._c.replace_item(item=property_id, body=updated.model_dump(mode="json"))
        return updated

    async def delete_property(self, property_id: str) -> bool:
        """Delete the property and every tenancy doc in its partition."""
        current = await self.get_property(property_id)
        if current is None:
            return False
        query = "SELECT c.id FROM c WHERE c.property_id = @pid"
        params = [{"name": "@pid", "value": property_id}]
        async for row in self._c.query_items(query=query, parameters=params):
            try:
                await self._c.delete_item(item=row["id"], partition_key=property_id)
            except CosmosResourceNotFoundError:
                pass
        return True

    async def list_properties_for_user(
        self, oid: str, email: str | None
    ) -> list[tuple[Property, MemberRole]]:
        """Return every property the user can access, with their role.

        Also reconciles email-only memberships: when an invited user logs in
        for the first time we stamp their oid onto the matching membership.
        """
        norm_email = _norm_email(email) if email else None
        memberships = await self._memberships_for_user(oid, norm_email)

        result: list[tuple[Property, MemberRole]] = []
        seen: set[str] = set()
        for m in memberships:
            if m.property_id in seen:
                continue
            seen.add(m.property_id)
            prop = await self.get_property(m.property_id)
            if prop is not None:
                result.append((prop, m.role))
        return result

    async def _memberships_for_user(
        self, oid: str, norm_email: str | None
    ) -> list[Membership]:
        query = (
            "SELECT * FROM c WHERE c.doc_type = 'membership' "
            "AND (c.user_oid = @oid OR (IS_NULL(c.user_oid) AND c.user_email = @email))"
        )
        params = [
            {"name": "@oid", "value": oid},
            {"name": "@email", "value": norm_email or "\u0000"},
        ]
        found: list[Membership] = []
        async for item in self._c.query_items(query=query, parameters=params):
            m = Membership(**item)
            if m.user_oid is None and norm_email and m.user_email == norm_email:
                m.user_oid = oid
                m.updated_at = _now()
                await self._c.replace_item(item=m.id, body=m.model_dump(mode="json"))
            found.append(m)
        return found

    async def get_membership(
        self, property_id: str, oid: str, email: str | None
    ) -> Membership | None:
        norm_email = _norm_email(email) if email else None
        query = (
            "SELECT * FROM c WHERE c.doc_type = 'membership' "
            "AND c.property_id = @pid "
            "AND (c.user_oid = @oid OR (IS_NULL(c.user_oid) AND c.user_email = @email))"
        )
        params = [
            {"name": "@pid", "value": property_id},
            {"name": "@oid", "value": oid},
            {"name": "@email", "value": norm_email or "\u0000"},
        ]
        async for item in self._c.query_items(query=query, parameters=params):
            m = Membership(**item)
            if m.user_oid is None and norm_email and m.user_email == norm_email:
                m.user_oid = oid
                m.updated_at = _now()
                await self._c.replace_item(item=m.id, body=m.model_dump(mode="json"))
            return m
        return None

    # ---- members ---- #
    async def list_members(self, property_id: str) -> list[Membership]:
        query = (
            "SELECT * FROM c WHERE c.doc_type = 'membership' AND c.property_id = @pid "
            "ORDER BY c.created_at ASC"
        )
        params = [{"name": "@pid", "value": property_id}]
        return [
            Membership(**i)
            async for i in self._c.query_items(query=query, parameters=params)
        ]

    async def find_member_by_email(
        self, property_id: str, email: str
    ) -> Membership | None:
        norm = _norm_email(email)
        for m in await self.list_members(property_id):
            if m.user_email == norm:
                return m
        return None

    async def add_member(
        self, property_id: str, email: str, role: MemberRole
    ) -> Membership:
        entity = Membership(
            id=new_membership_id(),
            property_id=property_id,
            user_email=_norm_email(email),
            role=role,
        )
        await self._c.create_item(body=entity.model_dump(mode="json"))
        return entity

    async def get_member(self, property_id: str, member_id: str) -> Membership | None:
        try:
            item = await self._c.read_item(item=member_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return None
        if item.get("doc_type") != "membership":
            return None
        return Membership(**item)

    async def update_member_role(
        self, property_id: str, member_id: str, role: MemberRole
    ) -> Membership | None:
        current = await self.get_member(property_id, member_id)
        if current is None:
            return None
        current.role = role
        current.updated_at = _now()
        await self._c.replace_item(item=member_id, body=current.model_dump(mode="json"))
        return current

    async def remove_member(self, property_id: str, member_id: str) -> bool:
        try:
            await self._c.delete_item(item=member_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return False
        return True

    # ---- gardens ---- #
    async def list_gardens(self, property_id: str) -> list[Garden]:
        query = (
            "SELECT * FROM c WHERE c.doc_type = 'garden' AND c.property_id = @pid "
            "ORDER BY c.created_at ASC"
        )
        params = [{"name": "@pid", "value": property_id}]
        return [
            Garden(**i)
            async for i in self._c.query_items(query=query, parameters=params)
        ]

    async def create_garden(self, property_id: str, payload: GardenCreate) -> Garden:
        entity = Garden(property_id=property_id, **payload.model_dump())
        await self._c.create_item(body=entity.model_dump(mode="json"))
        return entity

    async def get_garden(self, property_id: str, garden_id: str) -> Garden | None:
        try:
            item = await self._c.read_item(item=garden_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return None
        if item.get("doc_type") != "garden":
            return None
        return Garden(**item)

    async def update_garden(
        self, property_id: str, garden_id: str, payload: GardenUpdate
    ) -> Garden | None:
        current = await self.get_garden(property_id, garden_id)
        if current is None:
            return None
        data = current.model_dump()
        data.update(payload.model_dump(exclude_unset=True))
        data["updated_at"] = _now()
        updated = Garden(**data)
        await self._c.replace_item(item=garden_id, body=updated.model_dump(mode="json"))
        return updated

    async def delete_garden(self, property_id: str, garden_id: str) -> bool:
        try:
            await self._c.delete_item(item=garden_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return False
        return True


# --------------------------------------------------------------------------- #
# Tags
# --------------------------------------------------------------------------- #
class TagRepository:
    def __init__(self, db: Database) -> None:
        self._c = db.tenancy

    async def list(
        self,
        property_id: str,
        garden_id: str | None = None,
        scope: TagScope | None = None,
    ) -> list[Tag]:
        query = "SELECT * FROM c WHERE c.doc_type = 'tag' AND c.property_id = @pid"
        params = [{"name": "@pid", "value": property_id}]
        if garden_id is not None:
            query += " AND c.garden_id = @gid"
            params.append({"name": "@gid", "value": garden_id})
        if scope is not None:
            query += " AND c.scope = @scope"
            params.append({"name": "@scope", "value": scope.value})
        query += " ORDER BY c.name ASC"
        return [
            Tag(**i) async for i in self._c.query_items(query=query, parameters=params)
        ]

    async def get(self, property_id: str, tag_id: str) -> Tag | None:
        try:
            item = await self._c.read_item(item=tag_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return None
        if item.get("doc_type") != "tag":
            return None
        return Tag(**item)

    async def create(self, property_id: str, payload: TagCreate) -> Tag:
        entity = Tag(property_id=property_id, **payload.model_dump())
        await self._c.create_item(body=entity.model_dump(mode="json"))
        return entity

    async def update(
        self, property_id: str, tag_id: str, payload: TagUpdate
    ) -> Tag | None:
        current = await self.get(property_id, tag_id)
        if current is None:
            return None
        data = current.model_dump()
        data.update(payload.model_dump(exclude_unset=True))
        data["updated_at"] = _now()
        updated = Tag(**data)
        await self._c.replace_item(item=tag_id, body=updated.model_dump(mode="json"))
        return updated

    async def delete(self, property_id: str, tag_id: str) -> bool:
        try:
            await self._c.delete_item(item=tag_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return False
        return True


# --------------------------------------------------------------------------- #
# Plant classes (species) — property scoped
# --------------------------------------------------------------------------- #
class PlantClassRepository:
    def __init__(self, db: Database) -> None:
        self._c = db.classes

    async def list(self, property_id: str) -> list[PlantClass]:
        query = (
            "SELECT * FROM c WHERE c.doc_type = 'plant_class' AND c.property_id = @pid "
            "ORDER BY c.common_name"
        )
        params = [{"name": "@pid", "value": property_id}]
        items = [i async for i in self._c.query_items(query=query, parameters=params)]
        return [PlantClass(**i) for i in items]

    async def get(self, property_id: str, class_id: str) -> PlantClass | None:
        try:
            item = await self._c.read_item(item=class_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return None
        if item.get("doc_type") != "plant_class":
            return None
        return PlantClass(**item)

    async def create(self, property_id: str, payload: PlantClassCreate) -> PlantClass:
        entity = PlantClass(property_id=property_id, **payload.model_dump())
        await self._c.create_item(body=entity.model_dump(mode="json"))
        return entity

    async def update(
        self, property_id: str, class_id: str, payload: PlantClassUpdate
    ) -> PlantClass | None:
        current = await self.get(property_id, class_id)
        if current is None:
            return None
        data = current.model_dump()
        data.update(payload.model_dump(exclude_unset=True))
        data["updated_at"] = _now()
        updated = PlantClass(**data)
        await self._c.replace_item(item=class_id, body=updated.model_dump(mode="json"))
        return updated

    async def delete(self, property_id: str, class_id: str) -> bool:
        try:
            await self._c.delete_item(item=class_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return False
        return True


# --------------------------------------------------------------------------- #
# Plant instances — property scoped
# --------------------------------------------------------------------------- #
class PlantInstanceRepository:
    def __init__(self, db: Database) -> None:
        self._c = db.instances

    async def list(
        self,
        property_id: str,
        garden_id: str | None = None,
        class_id: str | None = None,
        tag_id: str | None = None,
    ) -> list[PlantInstance]:
        query = "SELECT * FROM c WHERE c.doc_type = 'plant_instance' AND c.property_id = @pid"
        params = [{"name": "@pid", "value": property_id}]
        if garden_id:
            query += " AND c.garden_id = @gid"
            params.append({"name": "@gid", "value": garden_id})
        if class_id:
            query += " AND c.class_id = @cid"
            params.append({"name": "@cid", "value": class_id})
        if tag_id:
            query += " AND ARRAY_CONTAINS(c.tag_ids, @tid)"
            params.append({"name": "@tid", "value": tag_id})
        query += " ORDER BY c.created_at DESC"
        items = [i async for i in self._c.query_items(query=query, parameters=params)]
        return [PlantInstance(**i) for i in items]

    async def get(self, property_id: str, instance_id: str) -> PlantInstance | None:
        try:
            item = await self._c.read_item(item=instance_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return None
        if item.get("doc_type") != "plant_instance":
            return None
        return PlantInstance(**item)

    async def get_any(self, instance_id: str) -> PlantInstance | None:
        """Cross-partition lookup by id alone (used by QR/NFC scan)."""
        query = "SELECT * FROM c WHERE c.id = @id AND c.doc_type = 'plant_instance'"
        params = [{"name": "@id", "value": instance_id}]
        async for item in self._c.query_items(query=query, parameters=params):
            return PlantInstance(**item)
        return None

    async def create(
        self, property_id: str, payload: PlantInstanceCreate
    ) -> PlantInstance:
        entity = PlantInstance(property_id=property_id, **payload.model_dump())
        await self._c.create_item(body=entity.model_dump(mode="json"))
        return entity

    async def update(
        self, property_id: str, instance_id: str, payload: PlantInstanceUpdate
    ) -> PlantInstance | None:
        current = await self.get(property_id, instance_id)
        if current is None:
            return None
        data = current.model_dump()
        data.update(payload.model_dump(exclude_unset=True))
        data["updated_at"] = _now()
        updated = PlantInstance(**data)
        updated.property_id = property_id
        await self._c.replace_item(item=instance_id, body=updated.model_dump(mode="json"))
        return updated

    async def replace(self, entity: PlantInstance) -> PlantInstance:
        entity.updated_at = _now()
        await self._c.replace_item(item=entity.id, body=entity.model_dump(mode="json"))
        return entity

    async def delete(self, property_id: str, instance_id: str) -> bool:
        try:
            await self._c.delete_item(item=instance_id, partition_key=property_id)
        except CosmosResourceNotFoundError:
            return False
        return True
